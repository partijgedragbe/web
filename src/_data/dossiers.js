import { readParquets, withParquets } from "./lib/duckdb.js";

const FILES = {
  dossiers: "src/data/sessions/56/dossiers.parquet",
  subdocuments: "src/data/sessions/56/subdocuments.parquet",
  members: "src/data/sessions/56/members.parquet",
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

      const fractionLookup = Object.fromEntries(
        membersRows.map((r) => [`${r[2]} ${r[3]}`, r[8]]),
      );

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

      const subdocumentsByDossier = {};
      subdocumentsRows.forEach((row) => {
        const dossierId = row[0];
        if (!subdocumentsByDossier[dossierId]) {
          subdocumentsByDossier[dossierId] = [];
        }
        subdocumentsByDossier[dossierId].push({
          id: row[1],
          date: row[2],
          type: row[3],
          authors: parseAuthors(row[4], fractionLookup),
          votes: votesByDossierAndDoc[`${dossierId}_${row[1]}`] ?? [],
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

      // Map dossiers.parquet rows to dossier object.
      const dossiers = dossiersRows.map((row) => {
        const subdocs = subdocumentsByDossier[row[1]] ?? [];
        const voteDate = row[7];
        const status = row[9];

        // Check if the vote we found matches the general status of the dossier.
        const voteMatchesStatusAndDate = (vote) => {
          if (!vote) return false;
          if (voteDate && vote.date !== voteDate) return false;
          const passed = status === "Aangenomen";
          if (passed) return vote.yes_count > vote.no_count;
          if (status === "Verworpen") return vote.no_count >= vote.yes_count;
          return true;
        };

        let plenaryVote = null;

        // Accepted-text doc types, in priority order
        const acceptedTypes = [
          "AangenomenTekst",
          "ArtikelenBijEersteStemmingAangenomen",
        ];

        // Try to find a vote on an accepted-type subdocument whose outcome matches status
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

        // If still nothing, look up votes keyed to ALL subdocuments and pick the one
        // whose outcome matches the dossier status (latest vote_id wins as tiebreak)
        if (!plenaryVote) {
          plenaryVote = subdocs
            .flatMap((s) => s.votes)
            .filter(voteMatchesStatusAndDate)
            .sort((a, b) => String(b.vote_id).localeCompare(String(a.vote_id)))
            .at(0) ?? null;
        }

        // Last resort: any vote, newest first
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
          submission_date: row[5],
          end_date: row[6],
          vote_date: row[7],
          document_type: row[8],
          status: row[9],
          eurovoc_main_descriptor: row[12],
          eurovoc_descriptors: row[13]
            ? row[13].split(",").map((d) => d.trim()).filter(Boolean)
            : [],
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
