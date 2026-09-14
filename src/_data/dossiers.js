import { readParquets, withParquets } from "./lib/duckdb.js";

const FILES = {
  dossiers: "src/data/sessions/56/dossiers/dossiers.parquet",
  subdocuments: "src/data/sessions/56/dossiers/subdocuments.parquet",
  members: "src/data/members.parquet",
  votes: "src/data/sessions/56/plenary/votes.parquet",
  dossiersSummaryContent: "src/data/summaries/dossier_content.parquet",
  dossiersArgumentsContent: "src/data/summaries/dossier_arguments.parquet",
};

const parseAuthors = (raw, fractionLookup) =>
  (raw || "").split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      fraction: (fractionLookup[name] ?? "Unknown").trim(),
    }));

const parseMembers = (raw, fractionLookup) =>
  (raw || "").split(",")
    .map((a) => a.trim())
    .filter(Boolean)
    .map((name) => ({
      name,
      fraction: (fractionLookup[name] ?? "Unknown").trim(),
    }));

const buildVotesByFraction = (yesRaw, noRaw, abstainRaw, fractionLookup) => {
  const result = {};
  const add = (raw, option) =>
    (raw || "").split(",").map((a) => a.trim()).filter(Boolean).forEach(
      (name) => {
        const fraction = (fractionLookup[name] ?? "Unknown").trim();
        if (!result[fraction]) result[fraction] = { yes: 0, no: 0, abstain: 0 };
        result[fraction][option]++;
      },
    );
  add(yesRaw, "yes");
  add(noRaw, "no");
  add(abstainRaw, "abstain");
  return result;
};

export default async function () {
  return withParquets({
    context: "dossiers",
    requiredFiles: Object.values(FILES),
    fallback: { dossiers: [] },
    loader: async (connection) => {
      const {
        dossiers: dossiersRows,
        subdocuments: subdocumentsRows,
        members: membersRows,
        votes: votesRows,
        dossiersSummaryContent: summaryRows,
        dossiersArgumentsContent: argumentsRows,
      } = await readParquets(connection, FILES);

      const session56Members = membersRows.filter(
        (row) => String(row[1]) === "56",
      );

      const fractionLookup = Object.fromEntries(
        session56Members.map((r) => [`${r[2]} ${r[3]}`, r[8]]),
      );

      // votes.parquet schema unchanged
      const votesByDossierAndDoc = {};
      votesRows.forEach((row) => {
        const docIdMatch = String(row[13]).match(/(\d+)$/);
        if (!docIdMatch) return;
        const key = `${row[12]}_${docIdMatch[1]}`;
        if (!votesByDossierAndDoc[key]) votesByDossierAndDoc[key] = [];

        votesByDossierAndDoc[key].push({
          vote_id: row[0],
          session_id: row[1],
          meeting_id: row[2],
          date: row[3],
          title_nl: row[4],
          title_fr: row[5],
          yes_count: row[6],
          no_count: row[7],
          abstain_count: row[8],
          yes_members: parseMembers(row[9], fractionLookup),
          no_members: parseMembers(row[10], fractionLookup),
          abstain_members: parseMembers(row[11], fractionLookup),
          dossier_id: row[12],
          document_id: row[13],
          votes_by_fraction: buildVotesByFraction(
            row[9],
            row[10],
            row[11],
            fractionLookup,
          ),
        });
      });

      // subdocuments.parquet: 0 session_id, 1 dossier_id, 2 id, 3 document_date,
      // 4 circulation_date, 5 type, 6 reading_phase, 7 authors, 8 file_url
      const subdocumentsByDossier = {};
      subdocumentsRows.forEach((row) => {
        const dossierId = row[1];
        if (!subdocumentsByDossier[dossierId]) {
          subdocumentsByDossier[dossierId] = [];
        }
        subdocumentsByDossier[dossierId].push({
          id: row[2],
          date: row[3],
          circulationDate: row[4],
          type: row[5],
          readingPhase: row[6],
          authors: parseAuthors(row[7], fractionLookup),
          fileUrl: row[8],
          votes: votesByDossierAndDoc[`${dossierId}_${row[2]}`] ?? [],
        });
      });

      const summaryByDossier = Object.fromEntries(
        summaryRows.map((r) => [r[6], r[1]]),
      );

      const titleByDossier = Object.fromEntries(
        summaryRows.map((r) => [r[6], r[3]]),
      );

      const descriptionByDossier = Object.fromEntries(
        summaryRows.map((r) => [r[6], r[4]]),
      );

      const groupArgumentsByFraction = (args) => {
        if (!args) return args;
        const grouped = {};
        for (const arg of args) {
          const key = arg.parties;
          if (!grouped[key]) grouped[key] = { fractions: key, arguments: [] };
          grouped[key].arguments.push(arg.argument);
        }
        return Object.values(grouped);
      };

      const argumentsByDossier = Object.fromEntries(
        argumentsRows.map((r) => {
          try {
            return [r[3], JSON.parse(r[1])];
          } catch {
            return [r[3], null];
          }
        }),
      );

      // dossiers.parquet: 0 session_id, 1 dossier_id, 2 last_updated, 3 title,
      // 4 authors, 5 procedure_type, 6 urgency_requested, 7 submission_date,
      // 8 end_date, 9 vote_date, 10 document_type, 11 status,
      // 12 latest_adopted_text_url, 13 latest_report_url,
      // 14 eurovoc_main_descriptor, 15 eurovoc_descriptors, 16 original_text_url
      const dossiers = dossiersRows.map((row) => {
        const subdocs = subdocumentsByDossier[row[1]] ?? [];
        const voteDate = row[9];
        const status = row[11];

        const voteMatchesStatusAndDate = (vote) => {
          if (!vote) return false;
          if (voteDate && vote.date !== voteDate) return false;
          const passed = status === "Aangenomen";
          if (passed) return vote.yes_count > vote.no_count;
          if (status === "Verworpen") return vote.no_count >= vote.yes_count;
          return true;
        };

        let plenaryVote = null;

        const acceptedTypes = [
          "AangenomenTekst",
          "ArtikelenBijEersteStemmingAangenomen",
          "VoorstelReglement",
        ];

        for (const type of acceptedTypes) {
          const matchingDocs = subdocs.filter((s) => s.type === type);
          for (const doc of matchingDocs) {
            const vote = doc.votes.find(voteMatchesStatusAndDate) ??
              doc.votes[0] ??
              null;
            if (vote) {
              plenaryVote = vote;
              break;
            }
          }
          if (plenaryVote) break;
        }

        if (!plenaryVote) {
          plenaryVote = subdocs
            .flatMap((s) => s.votes)
            .filter(voteMatchesStatusAndDate)
            .sort((a, b) => String(b.vote_id).localeCompare(String(a.vote_id)))
            .at(0) ?? null;
        }

        if (!plenaryVote) {
          plenaryVote = subdocs
            .flatMap((s) => s.votes)
            .sort((a, b) => String(b.vote_id).localeCompare(String(a.vote_id)))
            .at(0) ?? null;
        }

        return {
          session_id: row[0],
          dossier_id: row[1],
          last_updated: row[2],
          title: row[3],
          authors: parseAuthors(row[4], fractionLookup),
          procedure_type: row[5],
          urgency_requested: row[6],
          submission_date: row[7],
          end_date: row[8],
          vote_date: row[9],
          document_type: row[10],
          status: row[11],
          latest_adopted_text_url: row[12],
          latest_report_url: row[13],
          eurovoc_main_descriptor: row[14],
          eurovoc_descriptors: row[15]
            ? row[15].split(",").map((d) => d.trim()).filter(Boolean)
            : [],
          original_text_url: row[16],
          subdocuments: subdocs,
          summary: summaryByDossier[row[1]] ?? null,
          summarizedTitle: titleByDossier[row[1]] ?? null,
          summarizedDescription: descriptionByDossier[row[1]] ?? null,
          arguments: argumentsByDossier[row[1]]
            ? {
              ...argumentsByDossier[row[1]],
              arguments_pro: groupArgumentsByFraction(
                argumentsByDossier[row[1]].arguments_pro,
              ),
              arguments_contra: groupArgumentsByFraction(
                argumentsByDossier[row[1]].arguments_contra,
              ),
              arguments_neutral: groupArgumentsByFraction(
                argumentsByDossier[row[1]].arguments_neutral,
              ),
            }
            : null,
          plenaryVote,
        };
      });

      return { dossiers };
    },
  });
}
