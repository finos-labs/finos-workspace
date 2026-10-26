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

export interface ReportItem {
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

export interface HookEntry {
  value: string;
  files: string[];
}

export interface DataAttribute {
  name: string;
  count: number;
}

export interface HooksData {
  testIds: HookEntry[];
  ids: HookEntry[];
  dataAttributes: DataAttribute[];
}

export interface WebConfigField {
  field: string;
  path: string;
  containerVariable: string;
  buildVariable: string;
  type: string;
  default: unknown;
  values?: string[];
}

export interface WebConfigGroup {
  name: string;
  fields: WebConfigField[];
}

export interface WebConfigData {
  groups: WebConfigGroup[];
}

export interface EnvEntry {
  name: string;
  example: string;
  commented: boolean;
  description: string;
  section: string;
}

export interface EnvExample {
  file: string;
  entries: EnvEntry[];
}

export interface ProcessEnvEntry {
  name: string;
  files: string[];
  description: string;
  inExample: boolean;
}

export interface EnvData {
  backend: EnvExample;
  agent: EnvExample;
  agentProcessEnv: ProcessEnvEntry[];
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

export interface ApiParameter {
  name: string;
  in: string;
  required: boolean;
  type: TypeLabel;
  description?: string;
}

export interface ApiResponse {
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

export interface SettingField {
  name: string;
  group: string;
  type: string;
  required: boolean;
  default: unknown;
  hasDefaultFactory: boolean;
  description: string;
  inExample: boolean;
}

export interface SettingsData {
  fields: SettingField[];
}

export interface DatabaseColumn {
  name: string;
  type: string;
  nullable: boolean;
  primaryKey: boolean;
  unique: boolean;
  indexed: boolean;
  serverDefault: string | null;
  references: { column: string; onDelete: string | null }[];
}

export interface DatabaseTable {
  name: string;
  columns: DatabaseColumn[];
  indexes: { name: string | null; columns: string[]; unique: boolean }[];
  uniqueConstraints: { name: string | null; columns: string[] }[];
}

export interface DatabaseData {
  tables: DatabaseTable[];
}

export interface CliArgument {
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

export interface McpTool {
  name: string;
  description: string;
  parameters: SchemaDoc;
}

export interface McpResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string | null;
}

export interface McpPrompt {
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
