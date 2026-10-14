import tlds from "tlds";
import { getConfig } from "./runtimeConfig";
import type { Copilot } from "./state/copilot";

export const VERSION = import.meta.env.VITE_RELEASE_VERSION;

export const USER_AGENT_BACKEND = "app";
export const REFRESH_WIDGET_INTERVAL = 1000 * 60 * 15; // 15 minutes

export const ENABLE_SHARING = "true";
export const MAX_COPILOT_LINKS = 4;

// Save-conversation-as-skill (save_skill copilot function call).
// Payload budget for the skill generation request; the backend enforces the
// model context budget and is the authority on what actually reaches the LLM.
export const MAX_SKILL_CONVERSATION_TOTAL_CHARS = 400_000;
export const MAX_SKILL_CONVERSATION_MESSAGE_CHARS = 20_000;
// Mirror the limits enforced by the skill form schema in AddSkillDialog.
export const MAX_SKILL_SLUG_LENGTH = 50;
export const MAX_SKILL_DESCRIPTION_LENGTH = 500;

// Global hover-reveal delay (ms) shared by the Radix TooltipProvider and
// HoverPopover. skip = window after one closes where the next opens instantly.
export const TOOLTIP_OPEN_DELAY_MS = 700;
export const TOOLTIP_SKIP_DELAY_MS = 300;

// File types the File connector turns into widgets: each one opens in the PDF, HTML or
// Markdown viewer. The backend accepts these options too (it accepts more, for Copilot
// uploads).
// biome-ignore format: off
export const ExtensionOptions = ["pdf","txt","md","docx","html"] as const;

export type Extension = (typeof ExtensionOptions)[number];

export function validExtension(value: string): value is Extension {
  return ExtensionOptions.includes(value as Extension);
}

/** The viewer widget type for an uploaded file. */
export function getFileWidgetType(extension: string): "pdf" | "html" | "markdown" {
  if (extension === "pdf") return "pdf";
  if (extension === "html") return "html";
  return "markdown";
}

// Accept list for Copilot's file upload. Wider than ExtensionOptions: the Copilot
// also reads spreadsheets and images it is given as context.
export const COPILOT_ACCEPTED_MIME_TYPES = {
  "application/pdf": [".pdf"],
  "text/plain": [".txt"],
  "text/markdown": [".md", ".markdown"],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": [".docx"],
  "text/html": [".html"],
  "text/csv": [".csv"],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
  "image/png": [".png"],
  "image/jpeg": [".jpg", ".jpeg"],
} as const;

export const COPILOT_ACCEPTED_EXTENSIONS = Array.from(
  new Set(Object.values(COPILOT_ACCEPTED_MIME_TYPES).flat()),
);

// Runtime config accessors — safe to call at any point (falls back to import.meta.env)
export function getApiUrl() {
  return getConfig().urls.backend;
}
export function getAiApiUrl() {
  return getConfig().urls.ai;
}

/**
 * Copilot feature constants shared across components
 */

// All AI features that are available
export const ALL_AI_FEATURES = new Set([
  "streaming",
  "file-upload",
  "widget-dashboard-select",
  "widget-dashboard-search",
  "widget-global-search",
  "mcp-tools",
  "agent-orchestration",
  "feedback",
]);

// Features that can be enabled by agents (user-specified in agent configs)
export const AGENT_ENABLED_FEATURES = new Set([
  "widget-dashboard-select",
  "widget-dashboard-search",
]);

export const FILE_EXTENSIONS = [".pdf", ".txt", ".docx", ".md", ".html"];

export const UNIQUE_AVATAR_COLORS = [
  "#3174ad", // Blue
  "#c75d5d", // Red
  "#8e5e9a", // Purple
  "#4a9e6c", // Green
  "#a89132", // Olive/gold
  "#a55353", // Darker red
  "#9e6c4a", // Brown/orange
  "#7a5a9e", // Different purple
  "#7a7a7a", // Gray
  "#6c8e4a", // Green-olive
];

// max file size for file upload in bytes
export const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB

// total storage capacity for user in bytes
export const MAX_STORAGE_CAPACITY = 5 * 1024 * 1024 * 1024; // 5GB

// threshold for storage usage in percentage
export const STORAGE_THRESHOLD = 0.9;

const SUPPORTED_TLDs = tlds.join("|");

export const LINK_REGEX = new RegExp(
  `\\b((https?|ftp|file):\\/\\/[^\\s]+|[a-zA-Z0-9-]+(?:\\.[a-zA-Z0-9-]+)*\\.(?:${SUPPORTED_TLDs})\\S*)\\b`,
  "g",
);

// Email regex to identify and filter out email addresses
export const EMAIL_REGEX = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g;

export const AI_SUPPORTED_FILE_TYPES = [
  "pdf",
  "jpg",
  "jpeg",
  "png",
  // "application/json", // not supported yet by endpoint
  "csv",
  "md",
  "txt",
  "xlsx",
  "docx",
  "html",
] as const;

export const AI_AT_COMMANDS = {
  "@sec": "Search SEC fillings ",
};

export const AI_PROMPTS = {
  "Based on the company profile, please list comparable peers along with bullet points detailing their respective activities and products.":
    ["Company Profile"],
  "Using the financial statements, assess the trend in revenue growth over the past few years. What factors contributed to any significant fluctuations?":
    ["Financial Statements"],
  "Using the financial statements, analyze the gross and net profit margin trend. Has there been any improvement or decline, and what could be the reasons behind it?":
    ["Financial Statements"],
  "Using the financial statements, investigate any significant changes in capital expenditure levels and the impact these changes have on the company's growth prospects.":
    ["Financial Statements"],
  "Using the financial statements, in specific gross profit margin how efficiently is the company producing goods or services.":
    ["Financial Statements"],
  "Using the financial statement, in specific operating profit margin how profitable is the company. Double check the math.":
    ["Financial Statements"],
  "Using the financial statement, in specific earnings per share (EPS) is the business growing? How has it changed over the years?":
    ["Financial Statements"],
  "Using the financial statement, assess the company's liquidity position by analyzing current and quick ratios. Are there any concerns regarding its short-term solvency":
    ["Financial Statements"],
  "Using the financial statement, investigate the trend in debt levels and debt-to-equity ratio. How does the company's leverage position compare to industry peers":
    ["Financial Statements"],
  "Using the financial statement, can you analyze the shareholders' equity and discuss if a rising equity value is generally seen as positive?":
    ["Financial Statements"],
  "Using the financial statement, can you indicate the cash generated from core business operations in the operating cash flow and discuss how operating cash flow reflects on the company financial health?":
    ["Financial Statements"],
  "Using the financial statement, can you show the cash spent or gained from investments in capital assets in the investing cash flow and discuss if high outflows indicate significant capital investments?":
    ["Financial Statements"],
  "Using the financial statement, can you reveal the cash flows related to financing activities such as issuing shares, taking on debt, and repaying loans in the financing cash flow and discuss if consistently high financing inflows signal reliance on external financing?":
    ["Financial Statements"],
  "Using the financial statement, can you calculate the free cash flow and indicate the cash available for discretionary use like dividends, share buybacks, or debt repayment? Explain the reasoning.":
    ["Financial Statements"],
  "For each piece of news, rate the sentiment from -1 to +1, based on whether it is likely to affect the share price. Give just the headline and rating. Order the articles based on their sentiment score and output the results as a markdown table.":
    ["Company News"],
  "From all the company news, what are the 3 headlines that I should not miss based on how they can impact the stock price.":
    ["Company News"],
  "Based on management team, review leadership's track record in terms of ownership and product launched. Use general knowledge information to highlight any past accomplishments or negative press from these.":
    ["Management Team"],
  "What are the trends observed in terms of the revenue per business line? Acknowledge most positive and negative highlights.":
    ["Revenue Per Business Line"],
  "What are the trends observed in terms of the revenue per geography? Where is the company being successful and failing to expand?":
    ["Revenue Per Geography"],
  "Based on valuation multiples, is this company under or overvalued?": [
    "Valuation Multiples",
  ],
  "Based on valuation multiples, what are the growth expectations of the company?": [
    "Valuation Multiples",
  ],
  "Based on valuation multiples, what can I say regarding company's profitability and efficiency":
    ["Valuation Multiples"],
  "Based on valuation multiples, what is the financial health of the company? And are there any major risks I should be aware of?":
    ["Valuation Multiples"],
  "Based on valuation multiples, what is the market sentiment and expectations towards this company?":
    ["Valuation Multiples"],
  "Based on valuation multiples, what is the company dividend yield and how has it changed over time.":
    ["Valuation Multiples"],
  "Using the comparison analysis, conduct a comparative analysis with industry peers to benchmark the company's financial performance.":
    ["Comparison Analysis"],
  "How does this company compares against its peers in broader terms? What are the biggest outliers?":
    ["Comparison Analysis"],
  "Using the institutional ownership, what are some trends to notice?": [
    "Institutional Ownership",
  ],
  "Based on the stock ownership, create a table with the top 10 investors that have the most shares of the company and sort them? The table must contain their market value, how much portfolio weight they have in the company and their average price?":
    ["Stock Ownership"],
  "Assess the concentration of ownership. Are there a few large institutions holding significant stakes, or is ownership more evenly distributed?":
    ["Stock Ownership"],
  "Investigate any clusters of insider buying or selling. Do multiple insiders engage in transactions around the same time, and what does this suggest about sentiment or outlook?":
    ["Insider Trading"],
  "Based on insider trading, who are the top 3 buyers in the past year? How many shares did they buy, which type and how much did they spend on it in total?":
    ["Insider Trading"],
  "Based on insider trading, who are the top 3 sellers in the past year? How many shares did they sell and how much did they make from it?":
    ["Insider Trading"],
  "Analyze the timing of insider transactions relative to key company events or announcements. Are insiders buying or selling shares before significant news is made public":
    ["Insider Trading", "Company News"],
  "Evaluate the accuracy of analyst revenue forecasts relative to actual reported revenue figures. Are analysts consistently overestimating or underestimating revenue?":
    ["Financial Statements", "Analyst Estimates"],
  "Based on the last 10 years of earnings history, how have analysts estimated EPS and revenue and how has the company performed against it? On average did the company beat or miss the EPS and earnings? And by how much?":
    ["Earnings History"],
  "How is the dividend payment of the company evolving over time?": [
    "Dividend Payment",
  ],
  "Analyze the trend in dividend payouts and dividend yield. How does the company's dividend policy align with its financial performance?":
    ["Dividend Payment", "Financial Statements"],
  "What can you say about the analyst estimates?": ["Analyst Estimates"],
  "Review recent changes in analyst recommendations (e.g., buy, hold, sell). Have there been any notable shifts in sentiment":
    ["Price Target By Analyst"],
  "Who are the analysts that changed their price target by a wider margin over the past 3 months?":
    ["Price Target By Analyst"],
  "Are there analysts that changed their rating over the past year? If so, what company do they work at?":
    ["Price Target By Analyst"],
  "Using analysts consensus dataset, are there any companies that changed their grades on the company in the last few weeks?":
    ["Analyst Consensus"],
  "Evaluate management's guidance for future performance, including revenue, earnings, and key operational metrics. How does management view the company's growth prospects and potential challenges in the upcoming quarters?":
    ["Earnings Transcripts"],
  "Examine management's discussion and commentary on the company's performance during the earnings period. What are the key drivers behind the results, and how do they align with previous guidance or expectations?":
    ["Earnings Transcripts"],
  "Summarize this earnings transcripts in 3 bullet points. Then, describe company's future strategic roadmap in terms of deadlines for short, medium and long term. Then in another section, highlight 3 sentences that I should be trying to research further before investing in the stock.":
    ["Earnings Transcripts"],
  "Analyze the current earnings transcript against the one from the quarter before. Are there any noticeable shift in terms of strategy? What about financial changes? Is there any topic that was given less emphasis or added this quarter?":
    ["Earnings Transcripts"],
  "Using the earnings transcript, create a table with columns: financial metric, value, sentence in the earnings where it was extracted from. Double check whether the information you are using is correct.":
    ["Earnings Transcripts"],
  "What are the biggest global news of today? Explain why the headline is important and how it can impact my investment":
    ["Global News"],
};

// Default copilot configuration, does not call backend for agents.json
let _defaultCopilot: Copilot | null = null;
export function getDefaultCopilot(): Copilot {
  if (!_defaultCopilot) {
    _defaultCopilot = {
      id: "default-copilot",
      name: "Copilot",
      description: "Copilot is the default agent for Workspace.",
      image: "/assets/images/brand.png",
      endpoints: {
        upload_docs: "",
        query: `${getAiApiUrl()}/v1/query`,
      },
      features: {
        streaming: true,
        "file-upload": true,
        "widget-dashboard-select": true,
        "widget-dashboard-search": true,
        "widget-global-search": true,
        "mcp-tools": true,
        "agent-orchestration": true,
      },
    } as Copilot;

    _defaultCopilot.features = {
      ..._defaultCopilot.features,
      "workspace-web-search": {
        label: "Web Search",
        default: true,
        description: "Allows the copilot to search the web.",
      },
    };
  }
  return _defaultCopilot;
}

export const butterflyTypes = [
  "Azure Morpho",
  "Luna Moth",
  "Crimson Rose",
  "Orchid Swallowtail",
  "Jewel Longwing",
  "Golden Helicon",
  "Emerald Peacock",
  "Amethyst Hairstreak",
  "Pearl Crescent",
  "Ruby Admiral",
  "Sapphire Daggerwing",
  "Citrus Swallowtail",
  "Topaz Glasswing",
  "Silver Azure",
  "Violet Tip",
  "Marigold Monarch",
  "Celestial Tiger",
  "Opal Skipper",
  "Scarlet Peacock",
  "Coral Hairstreak",
  "Velvet Emperor",
  "Harmony Fritillary",
  "Rainbow Tiger",
  "Sunburst Swallowtail",
  "Velvet Daggerwing",
  "Harmony Blue",
  "Crimson Daggerwing",
  "Citrine Sulphur",
  "Azure Glassy Tiger",
  "Jade Hairstreak",
  "Harmony Admiral",
  "Diamond Skipper",
  "Amberwing Swallowtail",
  "Garnet Fritillary",
  "Rose Petal",
  "Silver Rim",
  "Cobalt Clipper",
  "Lemon Drop",
  "Velvet Rose",
  "Turquoise Admiral",
  "Lavender Daggerwing",
  "Scarlet Oakleaf",
  "Gold Banded Forester",
  "Lemon Emperor",
  "Blue Argus",
  "Harmony Jewel",
  "Ivory Lacewing",
  "Mint Swallowtail",
  "Ruby Ringlet",
  "Lilac Nymph",
  "Golden Monarch",
  "Snowflake Butterfly",
  "Bronze Daggerwing",
  "Buttercup Tiger",
  "Harmony Crescent",
  "Coral Admiral",
  "Sapphire Hairstreak",
  "Sunflower Skipper",
  "Orchid Admiral",
  "Silver Jewel",
  "Velvet Swallowtail",
  "Crimson Glasswing",
  "Blue Tiger",
  "Sunbeam Fritillary",
  "Azure Tiger",
  "Emerald Admiral",
  "Velvet Azure",
  "Moonstone Swallowtail",
  "Opal Monarch",
  "Azure Hairstreak",
  "Lemon Swallowtail",
  "Harmony Swallowtail",
  "Obsidian Daggerwing",
  "Jewel Fritillary",
  "Velvet Helicon",
  "Coral Ringlet",
  "Emerald Hairstreak",
  "Citrus Daggerwing",
  "Celestial Peacock",
  "Luna Admiral",
  "Topaz Swallowtail",
  "Garnet Hairstreak",
  "Crimson Tiger",
  "Silver Peacock",
  "Marigold Hairstreak",
  "Ruby Nymph",
  "Velvet Ringlet",
  "Azure Crescent",
  "Sunbeam Admiral",
  "Opal Tiger",
  "Golden Hairstreak",
  "Harmony Glasswing",
  "Diamond Azure",
  "Coral Peacock",
  "Lilac Admiral",
  "Celestial Hairstreak",
  "Sapphire Monarch",
  "Velvet Skipper",
  "Lemon Crescent",
  "Harmony Skipper",
  "Orchid Nymph",
  "Moonstone Hairstreak",
  "Harmony Oakleaf",
  "Turquoise Crescent",
  "Silver Daggerwing",
  "Jade Tiger",
  "Crimson Nymph",
  "Sunburst Daggerwing",
  "Amethyst Swallowtail",
  "Amber Ringlet",
  "Velvet Fritillary",
  "Azure Skipper",
  "Ivory Swallowtail",
  "Lemon Hairstreak",
  "Ruby Tiger",
  "Harmony Peacock",
  "Coral Skipper",
  "Lilac Ringlet",
  "Celestial Swallowtail",
  "Cobalt Swallowtail",
  "Diamond Admiral",
  "Scarlet Glasswing",
  "Emerald Nymph",
  "Sunflower Peacock",
  "Sapphire Oakleaf",
  "Velvet Monarch",
  "Coral Fritillary",
  "Rose Petal",
  "Silver Rim",
  "Cobalt Clipper",
  "Lemon Drop",
  "Velvet Rose",
  "Turquoise Admiral",
  "Lavender Daggerwing",
  "Scarlet Oakleaf",
  "Gold Banded Forester",
  "Lemon Emperor",
  "Blue Argus",
  "Harmony Jewel",
  "Ivory Lacewing",
  "Mint Swallowtail",
  "Ruby Ringlet",
  "Lilac Nymph",
  "Golden Monarch",
  "Snowflake Butterfly",
  "Bronze Daggerwing",
  "Buttercup Tiger",
  "Harmony Crescent",
  "Coral Admiral",
  "Sapphire Hairstreak",
  "Sunflower Skipper",
  "Orchid Admiral",
  "Silver Jewel",
  "Velvet Swallowtail",
  "Crimson Glasswing",
  "Blue Tiger",
  "Sunbeam Fritillary",
  "Azure Tiger",
  "Emerald Admiral",
  "Velvet Azure",
  "Moonstone Swallowtail",
  "Opal Monarch",
  "Azure Hairstreak",
  "Lemon Swallowtail",
  "Harmony Swallowtail",
  "Obsidian Daggerwing",
  "Jewel Fritillary",
  "Velvet Helicon",
  "Coral Ringlet",
  "Emerald Hairstreak",
  "Citrus Daggerwing",
  "Celestial Peacock",
  "Luna Admiral",
  "Topaz Swallowtail",
  "Garnet Hairstreak",
  "Crimson Tiger",
  "Silver Peacock",
  "Marigold Hairstreak",
  "Ruby Nymph",
  "Velvet Ringlet",
  "Azure Crescent",
  "Sunbeam Admiral",
  "Opal Tiger",
  "Golden Hairstreak",
  "Harmony Glasswing",
  "Diamond Azure",
  "Coral Peacock",
  "Lilac Admiral",
  "Celestial Hairstreak",
  "Sapphire Monarch",
  "Velvet Skipper",
  "Lemon Crescent",
  "Harmony Skipper",
  "Orchid Nymph",
  "Moonstone Hairstreak",
  "Harmony Oakleaf",
  "Turquoise Crescent",
  "Silver Daggerwing",
  "Jade Tiger",
  "Crimson Nymph",
  "Sunburst Daggerwing",
  "Amethyst Swallowtail",
  "Amber Ringlet",
  "Velvet Fritillary",
  "Azure Skipper",
  "Ivory Swallowtail",
  "Lemon Hairstreak",
  "Ruby Tiger",
  "Harmony Peacock",
  "Coral Skipper",
  "Lilac Ringlet",
  "Celestial Swallowtail",
  "Cobalt Swallowtail",
  "Diamond Admiral",
  "Scarlet Glasswing",
  "Emerald Nymph",
  "Sunflower Peacock",
  "Sapphire Oakleaf",
  "Velvet Monarch",
  "Coral Fritillary",
  "Rose Petal",
  "Silver Rim",
  "Cobalt Clipper",
  "Lemon Drop",
  "Velvet Rose",
  "Turquoise Admiral",
  "Lavender Daggerwing",
  "Scarlet Oakleaf",
  "Gold Banded Forester",
  "Lemon Emperor",
  "Blue Argus",
  "Harmony Jewel",
  "Ivory Lacewing",
  "Mint Swallowtail",
  "Ruby Ringlet",
  "Lilac Nymph",
  "Golden Monarch",
  "Snowflake Butterfly",
  "Bronze Daggerwing",
  "Buttercup Tiger",
  "Harmony Crescent",
  "Coral Admiral",
  "Sapphire Hairstreak",
  "Sunflower Skipper",
  "Orchid Admiral",
  "Silver Jewel",
  "Velvet Swallowtail",
  "Crimson Glasswing",
  "Blue Tiger",
  "Sunbeam Fritillary",
  "Azure Tiger",
  "Emerald Admiral",
  "Velvet Azure",
  "Moonstone Swallowtail",
  "Opal Monarch",
  "Azure Hairstreak",
  "Lemon Swallowtail",
  "Harmony Swallowtail",
  "Obsidian Daggerwing",
];

// For srcDoc= iframes holding a file a user put there (HtmlViewer) — the document inherits this
// app's origin. `allow-scripts` together with `allow-same-origin` means the sandbox holds nothing
// back: the document runs script as this app, with its storage and its session. On-prem with
// allowHtmlJsExecution enabled intentionally treats uploaded and fetched .html file widgets as
// trusted executable content, and allow-same-origin is required so their API calls send the correct
// Origin header (not `null`). Use this ONLY for content the deployment has decided to trust —
// never for content a model wrote (see ARTIFACT_SANDBOX_ATTRIBUTES).
export const IFRAME_SRCDOC_SANDBOX_ATTRIBUTES =
  "allow-scripts allow-forms allow-downloads allow-popups allow-same-origin";

// For srcDoc= iframes holding what a model wrote (Artifact.tsx). A model's output is shaped by
// whatever it has read — a fetched page, an uploaded document, a widget's rows — so it is not
// content the deployment has decided to trust, and it does not get this app's origin. Without
// `allow-same-origin` the document is on an opaque origin: script in it can still run and still
// post its height to the parent, but it cannot reach this app's storage, session or DOM.
// No `allow-forms` either: the artifact's own CSP sets `form-action 'none'`.
export const ARTIFACT_SANDBOX_ATTRIBUTES = "allow-scripts allow-downloads allow-popups";

// For an artifact whose scripts are off: nothing can run, so sharing the origin costs nothing and
// lets the app measure the document's height by reading it directly.
export const ARTIFACT_SANDBOX_ATTRIBUTES_NO_SCRIPTS = "allow-same-origin";

// For src= iframes (Iframe.tsx) — external URL origin, NOT parent origin.
// allow-same-origin lets external site use its own cookies/storage.
// SAFE: a different origin cannot access this app's localStorage.
export const IFRAME_SANDBOX_ATTRIBUTES = IFRAME_SRCDOC_SANDBOX_ATTRIBUTES;
