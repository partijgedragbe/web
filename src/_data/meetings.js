import { readParquets, withParquets } from "./lib/duckdb.js";
import { hashText } from "./lib/utils.js";

const FILES = {
  plenaryMeetings: "src/data/sessions/56/plenary/meetings.parquet",
  commissionMeetings: "src/data/sessions/56/commission/meetings.parquet",
  votes: "src/data/sessions/56/plenary/votes.parquet",
  plenaryQuestions: "src/data/sessions/56/plenary/questions.parquet",
  commissionQuestions: "src/data/sessions/56/commission/questions.parquet",
  propositions: "src/data/sessions/56/plenary/propositions.parquet",
  notices: "src/data/sessions/56/plenary/notices.parquet",
  members: "src/data/sessions/56/members.parquet",
  plenaryQuestionDiscussionsSummaries:
    "src/data/summaries/plenary_question_discussions.parquet",
  commissionQuestionDiscussionsSummaries:
    "src/data/summaries/commission_question_discussions.parquet",
  plenaryQuestionTopicsSummaries:
    "src/data/summaries/plenary_question_topics.parquet",
  commissionQuestionTopicsSummaries:
    "src/data/summaries/commission_question_topics.parquet",
  dossiers: "src/data/sessions/56/dossiers.parquet",
};

const TIME_OF_DAY_ORDER = { evening: 0, afternoon: 1, morning: 2 };

const dayIndex = (date, year) =>
  Math.floor((new Date(date) - new Date(year, 0, 1)) / 86_400_000);

const withFraction = (name, lookup) => ({
  name,
  fraction: lookup[name] ?? "Unknown",
});

const parseMembers = (raw, lookup) =>
  (raw || "").split(",").map((n) => withFraction(n.trim(), lookup)).filter((
    m,
  ) => m.name !== "");

const buildQuestionFromRow = (
  row,
  type,
  dateMap,
  fractionLookup,
  summaryByHash,
) => {
  const [questionId, sessionId, meetingId] = row;
  const date = dateMap.get(`${sessionId}-${meetingId}`) ?? null;
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
  return {
    type,
    question_id: questionId,
    session_id: sessionId,
    meeting_id: meetingId,
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
    discussion_ids: (row[8] || "").split(",").map((d) => d.trim()),
    discussion_summary_nl,
    internal_ids: row[9].split(","),
  };
};

const groupVotesByFraction = (yesWith, noWith, abstainWith) => {
  const grouped = {};
  [["yes", yesWith], ["no", noWith], ["abstain", abstainWith]].forEach(
    ([type, members]) => {
      members.forEach(({ name, fraction }) => {
        if (!grouped[fraction]) {
          grouped[fraction] = { yes: [], no: [], abstain: [] };
        }
        grouped[fraction][type].push({ name, fraction });
      });
    },
  );
  return grouped;
};

export default async function () {
  return withParquets({
    context: "meetings",
    requiredFiles: Object.values(FILES),
    fallback: { meetings: [] },
    loader: async (connection) => {
      const {
        plenaryMeetings: plenaryMeetingsRows,
        commissionMeetings: commissionMeetingsRows,
        votes: votesRows,
        plenaryQuestions: plenaryQuestionsRows,
        commissionQuestions: commissionQuestionsRows,
        propositions: propositionsRows,
        notices: noticesRows,
        members: membersRows,
        plenaryQuestionDiscussionsSummaries:
          plenaryQuestionDiscussionsSummariesRows,
        commissionQuestionDiscussionsSummaries:
          commissionQuestionDiscussionsSummariesRows,
        plenaryQuestionTopicsSummaries: plenaryQuestionTopicsSummariesRows,
        commissionQuestionTopicsSummaries:
          commissionQuestionTopicsSummariesRows,
        dossiers: dossiersRows,
      } = await readParquets(connection, FILES);

      // ── Lookup tables ────────────────────────────────────────────────────
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
      const dossierById = Object.fromEntries(
        dossiersRows.map((
          r,
        ) => [r[1], { authors: r[4], document_type: r[8], status: r[9] }]),
      );

      const activeMembers = membersRows
        .filter((r) => r[10] === "true")
        .map((r) => ({ name: `${r[2]} ${r[3]}`, fraction: r[8] ?? "Unknown" }));

      // ── Build meetings map (plenary + commission) ───────────────────────────────────────────────

      const meetings = {};

      plenaryMeetingsRows.forEach(
        ([sessionId, meetingId, date, time_of_day, start_time, end_time]) => {
          if (!meetings[sessionId]) meetings[sessionId] = [];
          meetings[sessionId].push({
            type: "plenary",
            commission_type: null,
            session_id: sessionId,
            meeting_id: meetingId,
            date,
            start_time,
            end_time,
            time_of_day,
            questions: [],
            propositions: [],
            notices: [],
            votes: [],
            allVotes: [],
            chair: "Peter De Roover",
          });
        },
      );

      commissionMeetingsRows.forEach(
        (
          [
            sessionId,
            commissionId,
            date,
            time_of_day,
            start_time,
            end_time,
            commissionName,
            chairsRaw,
          ],
        ) => {
          if (!meetings[sessionId]) meetings[sessionId] = [];
          meetings[sessionId].push({
            type: "commission",
            commission_type: commissionName,
            session_id: sessionId,
            meeting_id: commissionId,
            date,
            start_time,
            end_time,
            time_of_day,
            questions: [],
            propositions: [],
            notices: [],
            votes: [],
            allVotes: [],
            chairs: parseMembers(chairsRaw, fractionLookup),
          });
        },
      );

      // ── Attach questions ─────────────────────────────────────────────────

      const findMeeting = (sessionId, meetingId, type) =>
        meetings[sessionId]?.find((m) =>
          m.meeting_id === meetingId && m.type === type
        );

      plenaryQuestionsRows.forEach((row) => {
        const plenaryMeeting = findMeeting(row[1], row[2], "plenary");
        if (plenaryMeeting) {
          plenaryMeeting.questions.push(
            buildQuestionFromRow(
              row,
              "plenary",
              plenaryMeetingDateMap,
              fractionLookup,
              summaryByHash,
            ),
          );
        }
      });

      commissionQuestionsRows.forEach((row) => {
        if (row[1] === "404") return;
        const plenaryQuestion = findMeeting(row[1], row[2], "commission");
        if (plenaryQuestion) {
          plenaryQuestion.questions.push(
            buildQuestionFromRow(
              row,
              "commission",
              commissionMeetingDateMap,
              fractionLookup,
              summaryByHash,
            ),
          );
        }
      });

      // NOTICES
      noticesRows.forEach((row) => {
        const [
          noticeId,
          sessionId,
          meetingId,
          title_nl,
          title_fr,
        ] = row;
        const meeting = meetings[sessionId]?.find((m) =>
          m.meeting_id === meetingId
        );
        if (!meeting) return;
        meeting.notices.push({
          notice_id: noticeId,
          session_id: sessionId,
          meeting_id: meetingId,
          title_nl,
          title_fr,
        });
      });

      // PROPOSITIONS
      propositionsRows.forEach((row) => {
        const [
          propId,
          sessionId,
          meetingId,
          title_nl,
          title_fr,
          dossier_id,
          document_id,
        ] = row;
        const meeting = meetings[sessionId]?.find((m) =>
          m.meeting_id === meetingId
        );
        if (!meeting) return;
        const dossierData = dossierById[dossier_id] ?? {};
        meeting.propositions.push({
          proposition_id: propId,
          session_id: sessionId,
          meeting_id: meetingId,
          title_nl,
          title_fr,
          title_summary_nl: summaryByHash[hashText(title_nl ?? "")] ?? null,
          dossier_id,
          authors: parseMembers(dossierData.authors ?? "", fractionLookup),
          document_type: dossierData.document_type ?? null,
          status: dossierData.status ?? null,
          votes: [],
        });
      });

      // Index propositions by session+dossier for vote linking
      const propositionMap = new Map(
        Object.values(meetings).flat()
          .flatMap((m) => m.propositions)
          .filter((p) => p.dossier_id)
          .map((p) => [`${p.session_id}-${p.dossier_id}`, p]),
      );

      // ── Attach votes ─────────────────────────────────────────────────────

      votesRows.forEach((row) => {
        const [
          voteId,
          sessionId,
          meetingId,
          ,
          title_nl,
          title_fr,
          yes_count,
          no_count,
          abstain_count,
        ] = row;
        const meeting = meetings[sessionId]?.find((m) =>
          m.meeting_id === meetingId
        );
        if (!meeting) return;

        const yesWith = parseMembers(row[9], fractionLookup);
        const noWith = parseMembers(row[10], fractionLookup);
        const abstainWith = parseMembers(row[11], fractionLookup);
        const grouped = groupVotesByFraction(yesWith, noWith, abstainWith);

        const vote = {
          vote_id: voteId,
          session_id: sessionId,
          meeting_id: meetingId,
          date: plenaryMeetingDateMap.get(`${sessionId}-${meetingId}`) ?? null,
          title_nl,
          title_fr,
          yes_count,
          no_count,
          abstain_count,
          yes_members: yesWith,
          no_members: noWith,
          abstain_members: abstainWith,
          votes_by_fraction: Object.fromEntries(
            Object.entries(grouped).map((
              [p, v],
            ) => [p, {
              yes: v.yes.length,
              no: v.no.length,
              abstain: v.abstain.length,
            }]),
          ),
          grouped_votes_by_fraction: grouped,
          dossier_id: row[12],
          document_id: row[13],
        };

        const propKey = `${sessionId}-${vote.dossier_id}`;
        if (propositionMap.has(propKey)) {
          propositionMap.get(propKey).votes.push(vote);
        } else meeting.votes.push(vote);
        meeting.allVotes.push(vote);
      });

      // ── Flatten, sort, annotate ──────────────────────────────────────────

      let allMeetings = Object.values(meetings).flat().sort((a, b) => {
        const dateDiff = new Date(b.date) - new Date(a.date);
        if (dateDiff !== 0) return dateDiff;
        return (TIME_OF_DAY_ORDER[a.time_of_day] ?? 999) -
          (TIME_OF_DAY_ORDER[b.time_of_day] ?? 999);
      });

      allMeetings.forEach((meeting) => {
        const firstVote = meeting.allVotes[0];
        if (firstVote) {
          const yes = parseInt(firstVote.yes_count, 10) || 0;
          const no = parseInt(firstVote.no_count, 10) || 0;
          const abstain = parseInt(firstVote.abstain_count, 10) || 0;
          const presentNames = new Set([
            ...firstVote.yes_members,
            ...firstVote.no_members,
            ...firstVote.abstain_members,
          ].map((m) => m.name));
          meeting.attendance = {
            count: yes + no + abstain,
            ratio: (yes + no + abstain) / 150,
          };
          meeting.attendees = activeMembers
            .filter((m) => presentNames.has(m.name))
            .sort((a, b) => a.fraction.localeCompare(b.fraction));
          meeting.absentees = activeMembers
            .filter((m) => !presentNames.has(m.name))
            .sort((a, b) => a.fraction.localeCompare(b.fraction));
        } else {
          meeting.attendance = { count: 0, ratio: 0 };
          meeting.attendees = [];
          meeting.absentees = [];
        }
      });

      const computeDuration = (m) => {
        if (!m.start_time || !m.end_time) return 0;

        const [start, end] = [m.start_time, m.end_time].map((t) =>
          new Date(`1970-01-01T${t.replace("h", ":")}`)
        );

        const dur = (end - start) / 60_000;
        return dur < 0 ? dur + 1440 : dur;
      };

      const durations = {
        all: allMeetings.map(computeDuration),
        plenary: allMeetings
          .filter((m) => m.type === "plenary")
          .map(computeDuration),
        commission: allMeetings
          .filter((m) => m.type === "commission")
          .map(computeDuration),
      };

      const meetingsByDay = {};
      allMeetings.filter((m) => m.type === "plenary").forEach((m) => {
        const idx = dayIndex(m.date, 2026);
        if (!meetingsByDay[idx]) meetingsByDay[idx] = [];
        meetingsByDay[idx].push(m);
      });

      const commissionsByDay = {};
      allMeetings.filter((m) => m.type === "commission").forEach((m) => {
        const idx = dayIndex(m.date, 2026);
        if (!commissionsByDay[idx]) commissionsByDay[idx] = [];
        commissionsByDay[idx].push(m);
      });

      return {
        meetings: allMeetings,
        durations,
        meetingsByDay,
        commissionsByDay,
      };
    },
  });
}
