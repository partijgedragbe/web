import CleanCSS from "clean-css";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import translations from "../_data/translations.js";
import {
  differenceInDays,
  getYear,
  isAfter,
  isBefore,
  parseISO,
  startOfYear,
} from "date-fns";
import { DateTime } from "luxon";
import { minify } from "terser";
import { normaliseFraction } from "../_data/lib/fractionutils.js"; // adjust path as needed
import { meetingDescription } from "../_data/lib/meetingDescription.js";

export default function (eleventyConfig) {
  eleventyConfig.addNunjucksAsyncFilter("jsmin", async (code, callback) => {
    return code;
    try {
      const minified = await minify(code);
      return callback(null, minified.code);
    } catch (err) {
      console.error("Error during terser minify:", err);
      return callback(err, code);
    }
  });

  eleventyConfig.addFilter("activePlenaries", function (meetings) {
    if (!Array.isArray(meetings)) return [];

    return meetings.filter((meeting) => {
      return (
        meeting.type === "plenary" &&
        (
          (meeting.questions?.length || 0) > 0 ||
          (meeting.propositions?.length || 0) > 0 ||
          (meeting.allVotes?.length || 0) > 0
        )
      );
    });
  });

  // eleventyConfig.addFilter("cssmin", function (code) {
  //   return new CleanCSS({}).minify(code).styles;
  // });

  eleventyConfig.addFilter("normaliseFraction", function (raw) {
    if (!raw) return raw || "";
    return normaliseFraction(raw.toLowerCase());
  });

  eleventyConfig.addFilter("htmlDateString", (dateObj) => {
    return DateTime.fromJSDate(dateObj, { zone: "utc" }).toFormat("yyyy-LL-dd");
  });

  eleventyConfig.addFilter("lowercase", function (raw) {
    if (!raw) return raw || "";
    return raw.toLowerCase();
  });

  eleventyConfig.addFilter("sitemapDate", (dateObj) => {
    // Convert to local timezone +01:00 and set midnight
    return DateTime.fromJSDate(dateObj, { zone: "Europe/Brussels" })
      .startOf("day") // sets time to 00:00
      .toISO(); // outputs like 2025-08-06T00:00:00+01:00
  });

  eleventyConfig.addFilter("translate", function (key, lang = "nl") {
    return translations[lang]?.[key] || key;
  });

  eleventyConfig.addFilter("breadcrumbs", function (url) {
    if (!url) return [];
    // Collapse any double slashes before processing
    const clean = url.replace(/\/+/g, "/");
    const parts = clean.replace(/^\/|\/$/g, "").split("/").filter(Boolean);
    if (parts.length === 0) return [];
    let current = "";
    return parts.map((part) => {
      current += `/${part}`;
      return {
        key: part,
        name: part.replace(/-/g, " ").replace(/\b\w/g, (l) => l.toUpperCase()),
        url: current,
      };
    });
  });

  eleventyConfig.addFilter("getSubtopics", function (topicsData, topicName) {
    const topic = topicsData?.[topicName];

    if (!topic || !topic.subtopics) return [];

    return Object.keys(topic.subtopics).map((key) => ({
      name: key,
      keywords: topic.subtopics[key],
    }));
  });

  eleventyConfig.addFilter(
    "getSubtopic",
    function (item, parentTopic, topicsData) {
      if (!item || !parentTopic || !topicsData) return "";

      const topicName = parentTopic.name.toLowerCase();
      const topicEntry = topicsData[topicName];
      if (!topicEntry || !topicEntry.subtopics) return "";

      // Use topics_nl for questions, title_nl for propositions
      const text = (
        Array.isArray(item.topics_nl)
          ? item.topics_nl.join(";")
          : item.title_nl || ""
      ).toLowerCase();

      for (
        const [subtopicName, subKeywords] of Object.entries(
          topicEntry.subtopics,
        )
      ) {
        for (const keyword of subKeywords) {
          if (text.includes(keyword.toLowerCase())) {
            return subtopicName; // e.g. "Migratie"
          }
        }
      }

      return ""; // no subtopic matched — falls under the parent topic directly
    },
  );

  // Date Formatting Filter (dd/mm/yyyy)
  eleventyConfig.addFilter("date", function (value) {
    if (!value) return "";

    const date = new Date(value);

    if (Number.isNaN(date.getTime())) {
      console.warn("Invalid date:", value);
      return "";
    }

    return new Intl.DateTimeFormat("nl-BE", {
      year: "numeric",
      month: "long",
      day: "numeric",
    }).format(date);
  });

  eleventyConfig.addFilter("split", function (value, separator) {
    if (!value) return [];
    return String(value).split(separator);
  });

  // Date Formatting Filter (dd/mm/yy)
  eleventyConfig.addFilter("shortDate", function (date, format = "short") {
    const dateObj = new Date(date);

    if (format === "short") {
      const day = String(dateObj.getDate()).padStart(2, "0");
      const month = String(dateObj.getMonth() + 1).padStart(2, "0");
      const year = String(dateObj.getFullYear()).slice(-2); // Get last 2 digits of year
      return `${day}/${month}/${year}`;
    }

    // Fallback to the default long format if needed
    const options = { year: "numeric", month: "long", day: "numeric" };
    return new Intl.DateTimeFormat("nl-BE", options).format(dateObj);
  });

  eleventyConfig.addFilter("duration", function (start, end) {
    // Helper function to convert "14h16" format to minutes
    function timeToMinutes(time) {
      const [hours, minutes] = time.split("h").map(Number); // Split the string and convert to numbers
      return hours * 60 + (minutes || 0); // Convert hours to minutes and add minutes
    }

    const startMinutes = timeToMinutes(start);
    let endMinutes = timeToMinutes(end);

    // Check if the end time is before the start time, which means it's on the next day
    if (endMinutes < startMinutes) {
      endMinutes += 24 * 60; // Add 24 hours (in minutes) to the end time
    }

    const diffMinutes = endMinutes - startMinutes;

    const hours = Math.floor(diffMinutes / 60);
    const minutes = diffMinutes % 60;

    if (hours > 0 && minutes > 0) {
      return `${hours} uur en ${minutes} minuten`;
    } else if (hours > 0) {
      return `${hours} uur`;
    } else {
      return `${minutes} minuten`;
    }
  });

  eleventyConfig.addFilter("asQuestioner", function (questions) {
    return questions.filter((q) => !q.asRespondent);
  });

  eleventyConfig.addFilter("asRespondent", function (questions) {
    return questions.filter((q) => q.asRespondent);
  });

  eleventyConfig.addFilter("replace", function (value, from, to) {
    if (!value || !from) return value || "";

    // Coerce value to a string
    const str = String(value);
    const fromModified = from.charAt(0).toLowerCase() + from.slice(1);

    let complete = str.replaceAll(from, to);
    return complete.replaceAll(fromModified, to);
  });

  eleventyConfig.addFilter("round", function (value) {
    if (!value && value !== 0) return 0;
    return Math.round(value);
  });

  eleventyConfig.addFilter("toLowerCase", function (value) {
    if (!value) return value || "";
    return value.toLowerCase();
  });

  // Add this in your Eleventy config
  eleventyConfig.addFilter("groupBy", function (array, property) {
    if (!Array.isArray(array)) return {};

    return array.reduce((acc, item) => {
      const key = item[property] || "Unknown";
      if (!acc[key]) acc[key] = [];
      acc[key].push(item);
      return acc;
    }, {});
  });

  eleventyConfig.addFilter("highlightWord", function (value, word) {
    if (!value || !word) return value || "";

    // Escape special characters in the word
    const escapedWord = word.replace(/[-\/\\^$*+?.()|[\]{}]/g, "\\$&");

    // Create a case-insensitive RegExp for the word
    const regex = new RegExp(`(${escapedWord})`, "gi");

    return value.replace(regex, "<strong>$1</strong>");
  });

  eleventyConfig.addFilter("toJson", function (value) {
    return JSON.stringify(value, null, 2);
  });

  eleventyConfig.addFilter("makeUppercase", function (value) {
    return value.toUpperCase();
  });

  eleventyConfig.addFilter("capitalize", function (value) {
    return value.charAt(0).toUpperCase() + value.slice(1);
  });

  eleventyConfig.addFilter("padLeft", function (value, length, padChar) {
    return String(value).padStart(length, padChar);
  });

  eleventyConfig.addFilter("formatCurrency", function (number, short) {
    if (short) {
      return (
        Intl.NumberFormat("sfb", {
          style: "currency",
          currency: "EUR",
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(number / 1000) + "K"
      );
    } else {
      return new Intl.NumberFormat("sfb", {
        style: "currency",
        currency: "EUR",
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(number);
    }
  });

  eleventyConfig.addFilter("keys", function (obj) {
    if (obj && typeof obj === "object") {
      return Object.keys(obj);
    }
    return [];
  });

  // Age Calculation Filter
  eleventyConfig.addFilter("age", function (dateOfBirth) {
    if (!dateOfBirth || typeof dateOfBirth !== "string") return null;

    const [year, month, day] = dateOfBirth.trim().split("-").map(Number);

    if (!year || !month || !day) return null;

    const today = new Date();

    let age = today.getFullYear() - year;

    const monthDiff = today.getMonth() + 1 - month;

    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < day)) {
      age--;
    }

    return age;
  });

  // Unique Filter
  eleventyConfig.addFilter("unique", function (array) {
    return [...new Set(array)];
  });

  eleventyConfig.addFilter("imageExists", function (name) {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = dirname(__filename);
    const imagePath = path.join(__dirname, `${name}`);

    return fs.existsSync(imagePath);
  });

  eleventyConfig.addFilter("length", function (value) {
    if (Array.isArray(value)) {
      return value.length;
    } else if (typeof value === "string") {
      return value.length;
    }
    return 0; // Return 0 for non-array or non-string values
  });

  eleventyConfig.addFilter("getActive", function (functions, meetingDate) {
    if (!Array.isArray(functions)) {
      return null;
    }

    return (
      functions.find(
        (f) =>
          new Date(f.start_date) <= new Date(meetingDate) &&
          (!f.end_date || new Date(f.end_date) >= new Date(meetingDate)),
      ) || null
    );
  });

  eleventyConfig.addFilter("limit", function (array, amount) {
    if (!Array.isArray(array) || typeof amount !== "number") {
      return array;
    }
    return array.slice(0, amount);
  });

  eleventyConfig.addFilter("dayIndex", function (date, year) {
    if (!date) return null;

    const parsedDate = parseISO(date);

    // Ensure we're only processing 2025 dates
    if (getYear(parsedDate) !== year) return null;

    // Calculate the exact day index from Jan 1st
    const startOfYearDate = startOfYear(parsedDate);
    return differenceInDays(parsedDate, startOfYearDate);
  });

  eleventyConfig.addFilter("countTopics", function (questions, topics) {
    if (!Array.isArray(questions)) return [];

    const topicCounts = {};

    // Iterate through all the questions
    for (const q of questions) {
      const title = q.topic_nl || q.topics_nl.join(",") || ""; // Adjust if your question object uses a different field
      const titleLower = title.toLowerCase();

      let matchedTopics = []; // Array to store topics that match the question

      // Try to find a matching topic or subtopic based on keywords
      for (const [topic, data] of Object.entries(topics)) {
        // Check main topic keywords
        for (const keyword of data.keywords) {
          if (titleLower.includes(keyword.toLowerCase())) {
            matchedTopics.push(topic); // Add matched topic to the list
            break; // Stop checking further keywords for this topic
          }
        }

        // If you also want to check subtopics, you can do this:
        if (matchedTopics.length === 0) {
          for (
            const [subtopic, subKeywords] of Object.entries(
              data.subtopics || {},
            )
          ) {
            for (const subKeyword of subKeywords) {
              if (titleLower.includes(subKeyword.toLowerCase())) {
                matchedTopics.push(topic); // Add parent topic (not subtopic) to the list
                break; // Stop checking further subtopics
              }
            }
          }
        }
      }

      // If matched topics are found, increment their counts
      matchedTopics.forEach((topic) => {
        if (topicCounts[topic]) {
          topicCounts[topic]++;
        } else {
          topicCounts[topic] = 1;
        }
      });
    }

    // Convert to sorted array (descending by count)
    return Object.entries(topicCounts).sort((a, b) => b[1] - a[1]);
  });

  eleventyConfig.addFilter(
    "filterQuestionsByTopic",
    function (questions, topic, topicsData) {
      if (!Array.isArray(questions) || !topic || !topicsData) return [];

      const topicName = topic.name.toLowerCase(); // 'mobiliteit en transport' or maybe 'openbaar vervoer'

      // Try to find main topic first
      let topicEntry = topicsData[topicName];
      let isSubtopic = false;
      let parentTopicEntry = null;

      if (!topicEntry) {
        // Not a main topic, maybe it's a subtopic?
        for (const [mainTopic, data] of Object.entries(topicsData)) {
          for (const subtopicName of Object.keys(data.subtopics || {})) {
            if (subtopicName.toLowerCase() === topicName) {
              topicEntry = { keywords: data.subtopics[subtopicName] };
              isSubtopic = true;
              parentTopicEntry = data;
              break;
            }
          }
          if (topicEntry) break;
        }
      }

      if (!topicEntry) {
        // Still not found
        return [];
      }

      return questions.filter((q) => {
        const text = (q.topics_nl.join(";") || "").toLowerCase();

        // Match based on keywords
        for (const keyword of topicEntry.keywords || []) {
          if (text.includes(keyword.toLowerCase())) return true;
        }

        // (Optional: If filtering on a main topic, also match its subtopics)
        if (!isSubtopic && parentTopicEntry) {
          for (
            const subKeywords of Object.values(
              parentTopicEntry.subtopics || {},
            )
          ) {
            for (const subKeyword of subKeywords) {
              if (text.includes(subKeyword.toLowerCase())) return true;
            }
          }
        }

        return false;
      });
    },
  );

  eleventyConfig.addFilter(
    "filterPropositionsByTopic",
    function (propositions, topic, topicsData) {
      if (!Array.isArray(propositions) || !topic || !topicsData) return [];

      const topicName = topic.name.toLowerCase();

      return propositions.filter((q) => {
        const text = (q.title_nl || "").toLowerCase();

        // Match based on keywords in topicsData
        const topicEntry = topicsData[topicName];

        if (!topicEntry) return false;

        // Check main topic keywords
        for (const keyword of topicEntry.keywords || []) {
          if (text.includes(keyword.toLowerCase())) return true;
        }

        // Check subtopics (if any)
        for (const subKeywords of Object.values(topicEntry.subtopics || {})) {
          for (const subKeyword of subKeywords) {
            if (text.includes(subKeyword.toLowerCase())) return true;
          }
        }

        return false;
      });
    },
  );

  eleventyConfig.addFilter("getMatchedTopics", function (topicList, topics) {
    if (!Array.isArray(topicList)) {
      topicList = [topicList];
    }

    const matchedTopics = new Set();

    for (const [topicKey, topicData] of Object.entries(topics)) {
      // Match top-level keywords
      for (const keyword of topicData.keywords || []) {
        for (const t of topicList) {
          if (t.toLowerCase().includes(keyword.toLowerCase())) {
            matchedTopics.add(topicKey);
          }
        }
      }

      // Match subtopics
      for (
        const [subtopicName, subKeywords] of Object.entries(
          topicData.subtopics || {},
        )
      ) {
        for (const keyword of subKeywords) {
          for (const t of topicList) {
            if (t.toLowerCase().includes(keyword.toLowerCase())) {
              matchedTopics.add(subtopicName);
            }
          }
        }
      }
    }

    return Array.from(matchedTopics);
  });

  // Filter only plenary meetings
  eleventyConfig.addFilter("plenary", function (meetings) {
    if (!Array.isArray(meetings)) return [];
    return meetings.filter((m) => m.type === "plenary");
  });

  // Filter only commission meetings
  eleventyConfig.addFilter("commission", function (meetings) {
    if (!Array.isArray(meetings)) return [];
    return meetings.filter((m) => m.type === "commission");
  });

  eleventyConfig.addFilter("meetingDescription", meetingDescription);

  eleventyConfig.addFilter(
    "matchTopicByKeyword",
    function (questions, topic, topics) {
      if (!Array.isArray(questions)) return [];

      const matchedQuestions = [];

      // Get the keywords for the provided topic
      const keywords = topics[topic]?.keywords || [];

      if (keywords.length === 0) return matchedQuestions; // If no keywords for the topic, return empty list

      // Iterate through all questions and check if any keyword matches the question's title or body
      for (const question of questions) {
        for (const keyword of keywords) {
          for (const questionTopic of question.topics_nl) {
            if (questionTopic.toLowerCase().includes(keyword.toLowerCase())) {
              // Check if the combination of topics and meeting_id is already in matchedQuestions to avoid duplicates
              if (
                !matchedQuestions.some(
                  (q) =>
                    q.topics_nl.join(",") === question.topics_nl.join(",") &&
                    q.meeting_id === question.meeting_id,
                )
              ) {
                matchedQuestions.push(question);
              }
              break; // Stop checking further keywords if we already found a match
            }
          }
        }
      }

      return matchedQuestions;
    },
  );

  // Map filter
  eleventyConfig.addFilter("map", function (array, key) {
    if (!Array.isArray(array)) return [];
    return array.map((item) => item?.[key]);
  });

  // Unique filter
  eleventyConfig.addFilter("unique", function (array) {
    if (!Array.isArray(array)) return [];
    return [...new Set(array)];
  });

  // Sort filter (optional — for party names etc.)
  eleventyConfig.addFilter("sortAlpha", function (array) {
    if (!Array.isArray(array)) return [];
    return [...array].sort((a, b) => (a > b ? 1 : -1));
  });

  eleventyConfig.addFilter("filter", function (array, key, value) {
    if (!Array.isArray(array)) return [];
    return array.filter((item) => item?.[key] === value);
  });

  eleventyConfig.addFilter("oldest", function (array) {
    if (!Array.isArray(array) || array.length === 0) return null;
    return array.reduce((oldest, current) => {
      const oldestDate = parseISO(oldest.date_of_birth);
      const currentDate = parseISO(current.date_of_birth);
      return isBefore(currentDate, oldestDate) ? current : oldest;
    });
  });

  // Sort by key (ascending or descending)
  eleventyConfig.addFilter("sort", function (array, key, direction = "asc") {
    if (!Array.isArray(array)) return [];

    return array.slice().sort((a, b) => {
      const aVal = a?.[key] ?? 0;
      const bVal = b?.[key] ?? 0;

      return direction === "desc" ? bVal - aVal : aVal - bVal;
    });
  });

  eleventyConfig.addFilter(
    "sortDate",
    function (array, key, direction = "asc") {
      if (!Array.isArray(array)) return [];

      return array.slice().sort((a, b) => {
        const aVal = a?.[key];
        const bVal = b?.[key];

        if (aVal == null) return 1;
        if (bVal == null) return -1;

        let compare;
        if (aVal instanceof Date && bVal instanceof Date) {
          compare = aVal - bVal;
        } else if (!isNaN(Date.parse(aVal)) && !isNaN(Date.parse(bVal))) {
          // if it's a date string
          compare = new Date(aVal) - new Date(bVal);
        } else {
          // fallback to string comparison
          compare = String(aVal).localeCompare(String(bVal));
        }

        return direction === "desc" ? -compare : compare;
      });
    },
  );

  // Take first N items from an array
  eleventyConfig.addFilter("take", function (array, count) {
    if (!Array.isArray(array)) return [];
    return array.slice(0, count);
  });

  // 👶 Youngest member
  eleventyConfig.addFilter("youngest", function (array) {
    if (!Array.isArray(array) || array.length === 0) return null;
    return array.reduce((youngest, current) => {
      const youngestDate = parseISO(youngest.date_of_birth);
      const currentDate = parseISO(current.date_of_birth);
      return isAfter(currentDate, youngestDate) ? current : youngest;
    });
  });

  eleventyConfig.addFilter("contains", function (array, element) {
    if (!Array.isArray(array) || array.length === 0) return null;
    return array.includes(element);
  });

  eleventyConfig.addFilter("countItems", function (allMeetings, itemType) {
    if (!Array.isArray(allMeetings)) return 0;

    let itemCount = 0;

    allMeetings.forEach((meeting) => {
      // Check if the meeting has the specific itemType and is an array
      if (meeting[itemType] && Array.isArray(meeting[itemType])) {
        itemCount += meeting[itemType].length; // Count the items in the array
      }
    });

    return itemCount;
  });

  // Normalizes a Date object or date-like string into an ISO "yyyy-MM-dd"
  // string, for use in structured data (JSON-LD) fields.
  eleventyConfig.addFilter("isoDate", function (value) {
    if (!value) return "";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return "";
    return d.toISOString().slice(0, 10);
  });

  // Recursively strips null/undefined/empty values from a JSON-LD object so
  // optional schema.org fields can be included unconditionally in templates.
  eleventyConfig.addFilter("compactJsonLd", function compactJsonLd(value) {
    if (Array.isArray(value)) {
      return value
        .map(compactJsonLd)
        .filter((v) => v !== null && v !== undefined);
    }
    if (value && typeof value === "object") {
      const out = {};
      for (const [key, raw] of Object.entries(value)) {
        const cleaned = compactJsonLd(raw);
        const isEmptyObject =
          cleaned &&
          typeof cleaned === "object" &&
          !Array.isArray(cleaned) &&
          Object.keys(cleaned).length === 0;
        const isEmptyArray = Array.isArray(cleaned) && cleaned.length === 0;
        if (
          cleaned !== null &&
          cleaned !== undefined &&
          cleaned !== "" &&
          !isEmptyObject &&
          !isEmptyArray
        ) {
          out[key] = cleaned;
        }
      }
      return out;
    }
    return value;
  });

  // Builds a schema.org BreadcrumbList from the `breadcrumbs` filter's output.
  eleventyConfig.addFilter("breadcrumbJsonLd", function (crumbs) {
    if (!Array.isArray(crumbs)) return null;

    const itemListElement = [
      {
        "@type": "ListItem",
        position: 1,
        name: "Home",
        item: "https://partijgedrag.be/",
      },
      ...crumbs.map((crumb, index) => ({
        "@type": "ListItem",
        position: index + 2,
        name: crumb.name,
        item: `https://partijgedrag.be${crumb.url}/`,
      })),
    ];

    return {
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement,
    };
  });
}
