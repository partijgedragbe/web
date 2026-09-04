import { readParquets, withParquets } from "./lib/duckdb.js";
import { hashText } from "./lib/utils.js";

const FILES = {
  plenaryQuestions: "src/data/sessions/56/plenary/questions.parquet",
  commissionQuestions: "src/data/sessions/56/commission/questions.parquet",
  plenaryMeetings: "src/data/sessions/56/plenary/meetings.parquet",
  commissionMeetings: "src/data/sessions/56/commission/meetings.parquet",
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

const buildQuestionFromRow = (
  row,
  type,
  dateMap,
  fractionLookup,
  summaryByHash,
) => {
  const rawTopicsNl = row[6] || "";
  const rawDiscussion = row[8] || "";

  const discussion = JSON.parse(rawDiscussion || "[]").map((d) => ({
    speaker: withFraction(d.speaker, fractionLookup),
    text: d.text,
  }));

  const discussion_summary_nl =
    rawDiscussion.trim() && rawDiscussion.trim() !== "[]"
      ? (summaryByHash[hashText(rawDiscussion)] ?? null)
      : null;

  const date = dateMap.get(`${row[1]}-${row[2]}`) ?? null;

  return {
    type,
    question_id: row[0],
    session_id: row[1],
    meeting_id: row[2],
    date,
    questioners: parseMembers(row[3], fractionLookup),
    questionees: parseMembers(row[4], fractionLookup),
    respondents: parseMembers(row[5], fractionLookup),
    topics_nl: rawTopicsNl.split(";").map((t) => t.trim()),
    topics_fr: (row[7] || "").split(";").map((t) => t.trim()),
    topics_summary_nl: rawTopicsNl
      ? (summaryByHash[hashText(rawTopicsNl)] ?? null)
      : null,
    topics_summary_fr: rawTopicsNl
      ? (summaryByHash[hashText(rawTopicsNl)] ?? null)
      : null,
    discussion,
    discussion_summary_nl,
  };
};

export default async function () {
  return withParquets({
    context: "questions",
    requiredFiles: Object.values(FILES),
    fallback: { questions: [] },
    loader: async (connection) => {
      const {
        plenaryQuestions: plenaryQuestionsRows,
        commissionQuestions: commissionQuestionsRows,
        plenaryMeetings: plenaryMeetingsRows,
        commissionMeetings: commissionMeetingsRows,
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
      const commissionMeetingDateMap = new Map(
        commissionMeetingsRows.map((r) => [`${r[0]}-${r[1]}`, r[2]]),
      );

      const questions = [
        ...plenaryQuestionsRows.map((row) =>
          buildQuestionFromRow(
            row,
            "plenary",
            plenaryMeetingDateMap,
            fractionLookup,
            summaryByHash,
          )
        ),
        ...commissionQuestionsRows
          .filter((row) => row[1] !== "404")
          .map((row) =>
            buildQuestionFromRow(
              row,
              "commission",
              commissionMeetingDateMap,
              fractionLookup,
              summaryByHash,
            )
          ),
      ];

      return { questions };
    },
  });
}
