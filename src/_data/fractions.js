import { hashText } from "./lib/utils.js";
import { readParquets, withParquets } from "./lib/duckdb.js";

const FILES = {
  members: "src/data/members.parquet",
  questions: "src/data/sessions/56/plenary/questions.parquet",
  propositions: "src/data/sessions/56/plenary/propositions.parquet",
  dossiers: "src/data/sessions/56/dossiers/dossiers.parquet",
  meetings: "src/data/sessions/56/plenary/meetings.parquet",
  plenaryQuestionDiscussionsSummaries:
    "src/data/summaries/plenary_question_discussions.parquet",
  commissionQuestionDiscussionsSummaries:
    "src/data/summaries/commission_question_discussions.parquet",
  plenaryQuestionTopicsSummaries:
    "src/data/summaries/plenary_question_topics.parquet",
  commissionQuestionTopicsSummaries:
    "src/data/summaries/commission_question_topics.parquet",
};

const convertDate = (raw) => {
  if (!raw || typeof raw !== "string") return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const [day, month, year] = raw.split("/");
  if (!day || !month || !year) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
};

export default async function () {
  return withParquets({
    context: "fractions",
    requiredFiles: Object.values(FILES),
    fallback: {},
    loader: async (connection) => {
      const {
        members,
        questions,
        propositions,
        dossiers,
        meetings,
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

      const meetingDateMap = new Map(
        meetings.map((r) => [`${r[0]}-${r[1]}`, convertDate(r[2])]),
      );

      const fractions = {};
      const memberFractionMap = {};

      members.filter((row) => String(row[1]) === "56").forEach((row) => {
        const [
          memberId,
          sessionId,
          firstName,
          lastName,
          dob,
          pob,
          lang,
          constituency,
          fraction,
          memberFunction,
          email,
          active,
          start,
          end,
        ] = row;

        const key = `${firstName} ${lastName}`
          .trim()
          .toLowerCase()
          .replace(/\s+/g, "-");

        // Skip members without a fraction
        if (!fraction) return;

        memberFractionMap[key] = fraction;

        if (!fractions[fraction]) {
          fractions[fraction] = {
            name: fraction,
            members: new Set(),
            propositions: [],
            questions: [],
          };
        }

        fractions[fraction].members.add({
          member_id: memberId,
          session_id: sessionId,
          first_name: firstName,
          last_name: lastName,
          active,
          date_of_birth: dob,
          place_of_birth: pob,
          language: lang,
          constituency,
          function: memberFunction,
          email,
          start,
          end,
        });
      });

      const dossierById = Object.fromEntries(
        dossiers.map((d) => [
          d[1],
          {
            authors: (d[3] || "").split(",").map((a) =>
              a.trim().toLowerCase().replace(/\s+/g, "-")
            ).filter(Boolean),
            document_type: d[7],
            status: d[8],
            vote_date: convertDate(d[6]),
          },
        ]),
      );

      questions.forEach((q) => {
        const [questionId, sessionId, meetingId] = q;
        const date = meetingDateMap.get(`${sessionId}-${meetingId}`) ?? null;
        const rawQuestioners = q[3]?.split(",") ?? [];
        const rawQuestionees = q[4]?.split(",") ?? [];
        const rawRespondents = q[5]?.split(",") ?? [];
        const topicsNl = q[6]?.split(";").map((t) => t.trim()) ?? [];
        const topicsFr = q[7]?.split(";").map((t) => t.trim()) ?? [];
        const rawTopicsNl = q[6] || "";
        const topics_summary_nl = rawTopicsNl
          ? (summaryByHash[hashText(rawTopicsNl)] ?? null)
          : null;
        const rawDiscussion = q[8] || "";
        const discussion_summary_nl =
          rawDiscussion.trim() && rawDiscussion.trim() !== "[]"
            ? (summaryByHash[hashText(rawDiscussion)] ?? null)
            : null;
        const discussion = JSON.parse(rawDiscussion || "[]").map((d) => ({
          speaker: d.speaker,
          text: d.text,
        }));
        const discussionIds = q[9]?.split(",").map((d) => d.trim()) ?? [];

        const questionDetails = {
          question_id: questionId,
          session_id: sessionId,
          meeting_id: meetingId,
          type: "plenary",
          date,
          questioners: rawQuestioners.map((n) => ({
            name: n.trim(),
            fraction:
              memberFractionMap[n.trim().toLowerCase().replace(/\s+/g, "-")] ??
                "Unknown",
          })),
          questionees: rawQuestionees.map((n) => ({
            name: n.trim(),
            fraction:
              memberFractionMap[n.trim().toLowerCase().replace(/\s+/g, "-")] ??
                "Unknown",
          })),
          respondents: rawRespondents.map((n) => ({
            name: n.trim(),
            fraction:
              memberFractionMap[n.trim().toLowerCase().replace(/\s+/g, "-")] ??
                "Unknown",
          })),
          topics_nl: topicsNl,
          topics_fr: topicsFr,
          topics_summary_nl,
          discussion,
          discussion_ids: discussionIds,
          discussion_summary_nl,
        };

        rawQuestioners.forEach((name) => {
          const key = name.trim().toLowerCase().replace(/\s+/g, "-");
          const fraction = memberFractionMap[key];
          if (fraction && fractions[fraction]) {
            fractions[fraction].questions.push(questionDetails);
          }
        });
      });

      propositions.forEach((prop) => {
        const [
          propId,
          sessionId,
          meetingId,
          titleNl,
          titleFr,
          dossierId,
          documentId,
        ] = prop;
        const date = meetingDateMap.get(`${sessionId}-${meetingId}`) ?? null;
        const dossierData = dossierById[dossierId] ?? { authors: [] };
        const title_summary_nl =
          (titleNl && summaryByHash[hashText(titleNl)]) || null;

        const fractionsInvolved = new Set(
          dossierData.authors.map((a) => memberFractionMap[a]).filter(Boolean),
        );

        fractionsInvolved.forEach((fractionName) => {
          if (!fractions[fractionName]) {
            fractions[fractionName] = {
              name: fractionName,
              members: new Set(),
              propositions: [],
              questions: [],
            };
          }
          const alreadyHas = fractions[fractionName].propositions.some(
            (p) => p.proposition_id === propId && p.dossier_id === dossierId,
          );
          if (!alreadyHas) {
            fractions[fractionName].propositions.push({
              proposition_id: propId,
              session_id: sessionId,
              meeting_id: meetingId,
              date,
              title_nl: titleNl,
              title_fr: titleFr,
              title_summary_nl,
              dossier_id: dossierId,
              document_id: documentId,
              document_type: dossierData.document_type ?? null,
              status: dossierData.status ?? null,
              vote_date: dossierData.vote_date,
            });
          }
        });
      });

      Object.values(fractions).forEach((p) => {
        p.members = Array.from(p.members);
      });

      return Object.values(fractions);
    },
  });
}
