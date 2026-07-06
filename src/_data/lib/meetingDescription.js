export function meetingDescription(meeting) {
  if (!meeting) return "";

  const topics = [];

  for (const question of meeting.questions || []) {
    if (question.topics_summary_nl) {
      topics.push(cleanTopic(question.topics_summary_nl));
    } else if (Array.isArray(question.topics_nl) && question.topics_nl.length) {
      topics.push(cleanTopic(question.topics_nl[0]));
    }
  }

  const uniqueTopics = [...new Set(topics)].filter(Boolean).slice(0, 3);

  const topicPart = uniqueTopics.length > 0
    ? `over ${naturalList(uniqueTopics)}`
    : null;

  const extraParts = [];

  if (meeting.propositions?.length) {
    extraParts.push(
      `${meeting.propositions.length} ${
        meeting.propositions.length === 1 ? "wetsvoorstel" : "wetsvoorstellen"
      }`,
    );
  }

  if (meeting.allVotes?.length) {
    extraParts.push(
      `${meeting.allVotes.length} ${
        meeting.allVotes.length === 1 ? "stemming" : "stemmingen"
      }`,
    );
  }

  const extraPart = extraParts.length
    ? `over ${naturalList(extraParts)}`
    : null;

  if (!topicPart && !extraPart) {
    return "Tijdens deze plenaire vergadering werden geen vragen, voorstellen, stemming of mededelingen besproken maar werd wel andere inhoud besproken.";
  }

  if (topicPart && extraPart) {
    return `Vergadering ${topicPart}. Daarnaast ${extraPart}.`;
  }

  if (topicPart) {
    return `Vergadering ${topicPart}.`;
  }

  // only extraPart
  return `Vergadering ${extraPart}.`;
}

function cleanTopic(topic) {
  if (!topic) return "";

  topic = topic.trim();

  // lowercase first letter only
  topic = topic.charAt(0).toLowerCase() + topic.slice(1);

  // remove trailing punctuation
  topic = topic.replace(/[.!?]+$/, "");

  // NEW: wrap in quotes
  return `${topic}`;
}

function naturalList(items) {
  if (items.length === 1) return items[0];
  if (items.length === 2) return `${items[0]} en ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, en ${items.at(-1)}`;
}
