export type TypeLabel = (string | { ref: string })[];

export interface TokenUsage {
  classes: string[];
  uses: number;
  files: number;
  top: string[];
  direct: number;
  aliasedBy: number;
}

export interface Token {
  name: string;
  group: string;
  light?: string;
  dark?: string;
  forceLight?: string;
  lightColor?: string;
  darkColor?: string;
  usage?: TokenUsage;
}

export interface TokenFile {
  file: string;
  tokens: Token[];
}

export interface Selector {
  file: string;
  context: string[];
  selector: string;
  declarations: string[];
}

export interface Utility {
  file: string;
  name: string;
  declarations: string[];
  nested: { selector: string; declarations: string[] }[];
  uses?: number;
  files?: number;
  top?: string[];
}

export interface FontFace {
  file: string;
  family: string;
  style: string;
  weight: string;
  source: string;
}

export interface CssStats {
  variableUtilities: number;
  variableUses: number;
  variableFiles: number;
  builtInUses: number;
  builtInFiles: number;
}

interface ReportItem {
  classes: string[];
  description: string;
}

export interface ReportGroup {
  title: string;
  items: ReportItem[];
}

export interface ReportColour {
  element: string;
  colour: string;
  hex: string;
}

export interface ReportData {
  groups: ReportGroup[];
  colours: ReportColour[];
}

export interface PluginToken {
  name: string;
  property: string;
  light?: string;
  dark?: string;
}

export interface CssData {
  tokenFiles: TokenFile[];
  selectors: Selector[];
  utilities: Utility[];
  keyframes: { file: string; name: string }[];
  fontFaces: FontFace[];
  reportClasses: Selector[];
  stats: CssStats;
  report: ReportData;
  pluginTokens: PluginToken[];
}

export interface WebConfigField {
  field: string;
  path: string;
  containerVariable: string;
  buildVariable: string;
  type: string;
  default: unknown;
  description: string;
  values?: string[];
  itemValues?: string[];
}

export interface WebConfigGroup {
  name: string;
  fields: WebConfigField[];
}

export interface WebBuildVariable {
  name: string;
  description: string;
  default: string | null;
  values: string[] | null;
}

export interface WebConfigData {
  groups: WebConfigGroup[];
  buildVariables: WebBuildVariable[];
}

export interface AgentEnvVariable {
  name: string;
  group: string;
  readBy: string[];
  type: string;
  default: string | null;
  required: string | null;
  choices: string[] | null;
  providers: string[] | null;
  description: string;
}

export interface EnvData {
  agent: AgentEnvVariable[];
}

export interface SchemaProperty {
  name: string;
  type: TypeLabel;
  required: boolean;
  description?: string;
  notes: string[];
}

export interface SchemaDoc {
  name: string;
  description?: string;
  type: TypeLabel;
  properties: SchemaProperty[];
  notes: string[];
}

export interface SchemaSet {
  source: string;
  title: string;
  description?: string;
  root?: SchemaDoc;
  definitions: SchemaDoc[];
}

interface ApiParameter {
  name: string;
  in: string;
  required: boolean;
  type: TypeLabel;
  description?: string;
}

interface ApiResponse {
  code: string;
  description: string;
  schema?: TypeLabel;
}

export interface ApiOperation {
  method: string;
  path: string;
  tag: string;
  summary: string;
  parameters: ApiParameter[];
  requestBody?: { contentType: string; required: boolean; schema: TypeLabel };
  responses: ApiResponse[];
}

export interface ApiData {
  tags: { name: string; operations: ApiOperation[] }[];
  schemas: SchemaDoc[];
}

interface SettingField {
  name: string;
  group: string;
  type: string;
  required: boolean;
  default: unknown;
  hasDefaultFactory: boolean;
  description: string;
  choices: string[] | null;
}

export interface SettingsData {
  constants: Record<string, number | string>;
  fields: SettingField[];
}

interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  indexed: boolean;
  serverDefault: string | null;
  references: { column: string; onDelete: string | null }[];
}

interface DatabaseTable {
  name: string;
  columns: DatabaseColumn[];
  indexes: { name: string | null; columns: string[]; unique: boolean }[];
  uniqueConstraints: { name: string | null; columns: string[] }[];
}

export interface DatabaseData {
  tables: DatabaseTable[];
}

interface CliArgument {
  flags: string[];
  positional: boolean;
  required: boolean;
  help: string | null;
  default: unknown;
  choices: string[] | null;
  metavar: string | null;
  multiple: boolean;
}

export interface CliCommand {
  name: string;
  prog: string;
  help: string | null;
  description: string | null;
  arguments: CliArgument[];
  commands: CliCommand[];
}

export interface CliData {
  prog: string;
  description: string | null;
  commands: CliCommand[];
}

interface McpTool {
  name: string;
  description: string;
  parameters: SchemaDoc;
}

interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string | null;
}

interface McpPrompt {
  name: string;
  description: string;
  arguments: { name: string; description: string; required: boolean }[];
}

export interface McpData {
  instructions: string;
  tools: McpTool[];
  resources: McpResource[];
  prompts: McpPrompt[];
}

export interface AgentField {
  path: string;
  type: string;
  required: boolean;
  limits: string | null;
  description: string;
}

interface AgentRoute {
  method: string;
  path: string;
  needsToken: boolean;
  helperCalls: boolean;
  bodyLimitBytes: number | "INES_MAX_BODY_MB";
  summary: string;
}

interface AgentHelper {
  path: string;
  fields: AgentField[];
  detail: string;
  answer: string;
  fallback: string;
}

interface AgentMetric {
  name: string;
  type: string;
  labels: string[];
  labelValues: Record<string, string[]> | null;
  help: string;
}

interface AgentMcpTool {
  name: string;
  group: string;
  availability: string;
  scoped: boolean;
  description: string;
  fields: AgentField[];
}

interface AgentBridgeCommand {
  name: string;
  description: string;
  fields: AgentField[];
}

interface AgentToolGroup {
  id: string;
  summary: string;
  tools: string[];
  fromMcp: boolean;
  alwaysLoaded: boolean;
}

export interface AgentData {
  http: {
    routes: AgentRoute[];
    helpers: AgentHelper[];
    limits: { helperBodyBytes: number; transcribeBodyBytes: number; audioBytes: number; defaultMaxBodyMb: number };
  };
  metrics: AgentMetric[];
  mcp: {
    corsHeaders: string[];
    routes: { method: string; path: string; summary: string }[];
    tools: AgentMcpTool[];
    prompts: { name: string; description: string }[];
    resources: { uri: string; name: string; description: string; mimeType: string }[];
  };
  protocol: {
    events: { event: string; fields: string; meaning: string }[];
    extraState: { key: string; meaning: string }[];
    queryRequest: AgentField[];
    widget: AgentField[];
    bridgeCommands: AgentBridgeCommand[];
    coreTools: string[];
    toolGroups: AgentToolGroup[];
    typedResults: {
      kinds: string[];
      limits: { modelResultChars: number; historyChars: number; maxCitedPages: number; citedScoreShare: number };
    };
    limits: Record<string, number>;
  };
}

export interface ProtocolMessage {
  t: string;
  description: string;
  fields: AgentField[];
}

interface PluginPermission {
  name: string;
  meaning: string;
  command: string | null;
}

export interface PluginState {
  state: string;
  meaning: string;
}

interface PluginMetric {
  name: string;
  type: string;
  labels: string[];
  help: string;
}

export type PluginValueType = number | string | string[];

export interface PluginsData {
  permissions: PluginPermission[];
  permissionsLater: string[];
  commandErrors: string[];
  exportMembers: string[];
  exportOption: AgentField[];
  traits: string[];
  builtInTypes: string[];
  guestMessages: ProtocolMessage[];
  hostMessages: ProtocolMessage[];
  states: { plugin: PluginState[]; version: PluginState[] };
  metrics: PluginMetric[];
  cspFloor: { directive: string; sources: string[] }[];
  values: Record<string, PluginValueType>;
}

interface BridgeCommand {
  name: string;
  tool: string | null;
  meaning: string;
  fields: AgentField[];
}

export interface BridgeData {
  errorCodes: string[];
  agentOnlyCommands: string[];
  commands: BridgeCommand[];
  toTab: ProtocolMessage[];
  toApi: ProtocolMessage[];
  result: AgentField[];
  values: Record<string, PluginValueType>;
}

export interface WebData {
  port: number;
}
