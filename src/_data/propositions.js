import { readParquets, withParquets } from "./lib/duckdb.js";
import { hashText } from "./lib/utils.js";

const FILES = {
  propositions: "src/data/sessions/56/plenary/propositions.parquet",
  plenaryMeetings: "src/data/sessions/56/plenary/meetings.parquet",
  dossiers: "src/data/sessions/56/dossiers.parquet",
  members: "src/data/members.parquet",
  plenaryQuestionDiscussionsSummaries:
    "src/data/summaries/plenary_question_discussions.parquet",
  commissionQuestionDiscussionsSummaries:
    "src/data/summaries/commission_question_discussions.parquet",
  plenaryQuestionTopicsSummaries:
    "src/data/summaries/plenary_question_topics.parquet",
  commissionQuestionTopicsSummaries:
    "src/data/summaries/commission_question_topics.parquet",
};

const withFraction = (name, lookup) => ({
  name,
  fraction: lookup[name] ?? "Unknown",
});

const parseMembers = (raw, lookup) =>
  (raw || "").split(",").map((n) => withFraction(n.trim(), lookup));

const convertDate = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  const [day, month, year] = raw.split("/");
  if (!day || !month || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

export default async function () {
  return withParquets({
    context: "propositions",
    requiredFiles: Object.values(FILES),
    fallback: { propositions: [] },
    loader: async (connection) => {
      const {
        propositions: propositionsRows,
        plenaryMeetings: plenaryMeetingsRows,
        dossiers: dossiersRows,
        members: membersRows,
        plenaryQuestionDiscussionsSummaries:
          plenaryQuestionDiscussionsSummariesRows,
        commissionQuestionDiscussionsSummaries:
          commissionQuestionDiscussionsSummariesRows,
        plenaryQuestionTopicsSummaries: plenaryQuestionTopicsSummariesRows,
        commissionQuestionTopicsSummaries:
          commissionQuestionTopicsSummariesRows,
      } = await readParquets(connection, FILES);

      const summaryByHash = Object.fromEntries(
        plenaryQuestionDiscussionsSummariesRows.map((r) => [r[0], r[2]])
          .concat(
            commissionQuestionDiscussionsSummariesRows.map((r) => [r[0], r[2]]),
          )
          .concat(plenaryQuestionTopicsSummariesRows.map((r) => [r[0], r[2]]))
          .concat(
            commissionQuestionTopicsSummariesRows.map((r) => [r[0], r[2]]),
          ),
      );

      const fractionLookup = Object.fromEntries(
        membersRows.map((r) => [`${r[2]} ${r[3]}`, r[8]]),
      );

      const plenaryMeetingDateMap = new Map(
        plenaryMeetingsRows.map((r) => [`${r[0]}-${r[1]}`, r[2]]),
      );

      const dossierById = Object.fromEntries(
        dossiersRows.map((r) => [
          r[1],
          {
            authors: parseMembers(r[3], fractionLookup),
            document_type: r[7],
            status: r[8],
            vote_date: convertDate(r[6]),
          },
        ]),
      );

      const propositions = propositionsRows.map((row) => {
        const [propId, sessionId, meetingId, title_nl, title_fr, dossier_id] =
          row;
        const dossierData = dossierById[dossier_id] ?? {};
        return {
          proposition_id: propId,
          session_id: sessionId,
          meeting_id: meetingId,
          date: plenaryMeetingDateMap.get(`${sessionId}-${meetingId}`) ?? null,
          title_nl,
          title_fr,
          title_summary_nl: summaryByHash[hashText(`${title_nl}.`)] ?? null,
          dossier_id,
          authors: dossierData.authors ?? [],
          document_type: dossierData.document_type ?? null,
          status: dossierData.status ?? null,
          vote_date: dossierData.vote_date ?? null,
        };
      });

      return { propositions };
    },
  });
}
