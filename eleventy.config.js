import pluginFilters from "./src/_config/filters.js";
import { eleventyImageTransformPlugin } from "@11ty/eleventy-img";
import { EleventyI18nPlugin } from "@11ty/eleventy";
import pluginIcons from "eleventy-plugin-icons";
import fs from "node:fs";
import path from "node:path";
import pluginRss from "@11ty/eleventy-plugin-rss";
import lucideIcons from "@grimlink/eleventy-plugin-lucide-icons";
import pluginToc from "eleventy-plugin-toc";
import * as pagefind from "pagefind";
import EleventyPluginOgImage from "eleventy-plugin-og-image";

export default async function (eleventyConfig) {
  // Pass through assets
  eleventyConfig.addPassthroughCopy({
    "./src/assets/icons": "/",
  });
  eleventyConfig.addPassthroughCopy({ "./src/assets/js": "assets/js" });
  eleventyConfig.addPassthroughCopy({ "./src/assets/css": "assets/css" });
  eleventyConfig.addPassthroughCopy({ "./src/assets/fonts": "assets/fonts" });
  eleventyConfig.addPassthroughCopy({
    "./src/data/members.parquet": "data/members.parquet",
  });
  eleventyConfig.addPassthroughCopy({
    "./src/data/meetings.parquet": "data/meetings.parquet",
  });
  eleventyConfig.addPassthroughCopy({
    "./src/data/questions.parquet": "data/questions.parquet",
  });
  eleventyConfig.addPassthroughCopy({
    "./src/data/propositions.parquet": "data/propositions.parquet",
  });
  eleventyConfig.addPassthroughCopy({
    "./src/data/votes.parquet": "data/votes.parquet",
  });
  eleventyConfig.addPassthroughCopy({
    "./src/data/remunerations.parquet": "data/remunerations.parquet",
  });
  eleventyConfig.addPassthroughCopy({ "./src/metadata/": "metadata" });
  eleventyConfig.addPassthroughCopy("robots.txt");
  eleventyConfig.addPassthroughCopy("sitemap.xsl");
  eleventyConfig.addPassthroughCopy("google20354ba7c9e75d27.html");

  // Plugins
  eleventyConfig.addPlugin(pluginRss);
  eleventyConfig.addPlugin(pluginFilters);
  eleventyConfig.addPlugin(pluginToc, {
    tags: ["h1", "h2"],
    wrapper: "",
    ul: true,
  });
  eleventyConfig.addPlugin(EleventyI18nPlugin, {
    defaultLanguage: "nl",
  });
  eleventyConfig.addPlugin(lucideIcons, {
    class: "icon",
    width: 16,
    height: 16,
  });
  eleventyConfig.addPlugin(eleventyImageTransformPlugin);
  eleventyConfig.addPlugin(pluginIcons, {
    mode: "inline",
    sources: [{ name: "lucide", path: "node_modules/lucide-static/icons" }],
    icon: {
      shortcode: "icon",
      delimiter: ":",
      transform: async (content) => content,
      class: (name, source) => `icon icon-${name}`,
      id: (name, source) => `icon-${name}`,

      attributes: {
        width: "16",
        height: "16",
      },

      attributesBySource: {},
      overwriteExistingAttributes: true,
      errorNotFound: true,
    },
    sprite: {
      shortcode: "spriteSheet",
      attributes: {
        class: "sprite-sheet",
        "aria-hidden": "true",
        xmlns: "http://www.w3.org/2000/svg",
      },
      extraIcons: {
        all: false,
        sources: [],
        icons: [],
      },
      writeFile: false,
    },
  });
  eleventyConfig.addPlugin(EleventyPluginOgImage, {
    satoriOptions: {
      fonts: [
        {
          name: "Public Sans",
          data: fs.readFileSync(
            "./src/assets/fonts/og-font.woff",
          ),
          weight: 700,
          style: "normal",
        },
      ],
    },
  });

  // Pagefind (search), runs after eleventy has built the site
  // https://pagefind.app/docs/node-api/
  eleventyConfig.on("eleventy.after", async function ({ dir }) {
    const outputPath = path.join(dir.output, "pagefind");
    console.log("Creating Pagefind index of %s", dir.output);

    // Create a pagefind search index
    const { index } = await pagefind.createIndex();

    // Index all HTML files in the eleventy output directory
    const { page_count } = await index.addDirectory({
      path: dir.output,
    });

    // Write the index to disk
    await index.writeFiles({ outputPath });

    console.log(
      "Created Pagefind index of %i pages in %s",
      page_count,
      outputPath,
    );
  });

  // Collections.
  eleventyConfig.addCollection("members", function (collectionApi) {
    // return [];
    return collectionApi.items[0].data.members.members.map((member) => ({
      ...member,
    }));
  });

  eleventyConfig.addCollection("votes", function (collectionApi) {
    // return [];
    const votes = collectionApi.items[0].data.votes.votes.map((vote) => ({
      ...vote,
    }));
    return votes;
  });

  eleventyConfig.addCollection("posts", (collection) => {
    return collection.getFilteredByGlob("**/blog/**/*.md");
  });

  eleventyConfig.addCollection("commissions", function (collectionApi) {
    // return [];
    return collectionApi.items[0].data.commissions;
  });

  eleventyConfig.addCollection("fractions", function (collectionApi) {
    // return [];
    return collectionApi.items[0].data.fractions;
  });

  eleventyConfig.addCollection("meetings", function (collectionApi) {
    return collectionApi.items[0].data.meetings.meetings
      .map((meeting) => ({ ...meeting }));
  });

  eleventyConfig.addCollection("plenaryMeetings", function (collectionApi) {
    const meetings = collectionApi.items[0].data.meetings.meetings
      .filter((m) => m.type === "plenary")
      .map((m) => ({ ...m }));

    // CRITICAL: ensure correct order (by date + time fallback)
    meetings.sort((a, b) => {
      const aTime = new Date(`${a.date}T${a.start_time}`);
      const bTime = new Date(`${b.date}T${b.start_time}`);
      return aTime - bTime;
    });

    // attach prev/next
    return meetings.map((meeting, index) => {
      return {
        ...meeting,
        previousMeeting: index < meetings.length - 1
          ? meetings[index + 1]
          : null,
        nextMeeting: index > 0 ? meetings[index - 1] : null,
      };
    });
  });

  eleventyConfig.addCollection("commissionMeetings", function (collectionApi) {
    // return [];
    return collectionApi.items[0].data.meetings.meetings
      .filter((meeting) => meeting.type === "commission")
      .map((meeting) => ({ ...meeting }));
  });

  eleventyConfig.addCollection("dossiers", function (collectionApi) {
    // return [];
    return collectionApi.items[0].data.dossiers.dossiers.map((dossier) => ({
      ...dossier,
    }));
  });

  eleventyConfig.addCollection("mainTopics", function (collectionApi) {
    // return [];
    const topicsData = collectionApi.items[0].data.topics;

    return Object.keys(topicsData).map((mainTopicKey) => {
      const mainTopicData = topicsData[mainTopicKey];

      return {
        type: "main",
        name: mainTopicKey,
        label: mainTopicData.nl || mainTopicKey,
        icon: mainTopicData.icon || "",
        keywords: mainTopicData.keywords || [],
      };
    });
  });

  eleventyConfig.addCollection(
    "sitemap",
    (api) =>
      api.getAll().filter((item) => {
        const val = item.data.sitemap;
        return val === true || val === "true";
      }),
  );

  // Watch targets
  eleventyConfig.addWatchTarget("src/_includes");
  eleventyConfig.addWatchTarget("src/content");
  eleventyConfig.addWatchTarget("./src/assets");
  eleventyConfig.addWatchTarget("src/blog");

  eleventyConfig.setServerOptions({
    liveReload: true,
    output: "_site",
  });
}

export const config = {
  dir: {
    input: "src/content",
    includes: "../_includes",
    data: "../_data",
    output: "_site",
  },
};
