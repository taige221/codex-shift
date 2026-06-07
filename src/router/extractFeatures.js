import { detectReadOnly, normalizePrompt, stripReadOnlySignals } from "./privacy.js";

const TECHNICAL_IDENTIFIER_PATTERN = /`[^`]+`|--[a-z0-9][a-z0-9-]*|\b[a-z0-9]+(?:[-_/][a-z0-9]+)+\b|\b[a-z_]+_[a-z0-9_]+\b|\b[a-z][a-z0-9]*[A-Z][A-Za-z0-9]*\b|\b[\w./-]+\.(?:js|ts|json|md|toml|yaml|yml)\b/;
const MIXED_LANGUAGE_IDENTIFIER_PATTERN = /[\u3400-\u9fff][^\n]*\b[a-z][a-z0-9_-]{1,}\b|\b[a-z][a-z0-9_-]{1,}\b[^\n]*[\u3400-\u9fff]/i;
const TECHNICAL_CONTEXT_PATTERN = /\b(cli|api|sdk|server|client|request|response|event|state|cache|config|option|flag|command|session|transport|protocol|socket|parser|parsing|middleware|plugin|extension|component|ui|db|database|sql|json|rpc|http|stream|stdin|stdout)\b|代码|实现|接口|命令|参数|配置|状态|会话|请求|响应|协议|服务|客户端|解析|组件|插件|数据库|缓存|日志|行为/i;
const INVESTIGATION_OR_FIX_INTENT_PATTERN = /\b(fix|debug|check|inspect|trace|investigate|diagnose|repair)\b|检查|排查|修复|修一下|看下原因|再看|看看|继续修|继续排查/;
const CHANGE_INTENT_PATTERN = /\b(add|implement|change|support|wire|build|create)\b|加一个|加入|新增|添加|接入|改一下|完善|支持|增加|改成/;
const STRONG_REGRESSION_PATTERN = /\b(regression|broke|broken|not working|stopped working|no longer works)\b|没生效|没有生效|失效|破坏|回归|复现/;
const RECURRENCE_MARKER_PATTERN = /\b(still|again)\b|还是|仍然|依然|又|再|再次|刚刚|之前/;
const NEGATIVE_ISSUE_STATE_PATTERN = /\b(issue|bug|problem|error|failure|failing|failed|wrong)\b|问题|不对|异常|失败|报错|错误|故障|影响/;
const DEEP_ENGINEERING_SURFACE_PATTERN = /\b(protocol|transport|socket|stream|json-?rpc|request|response|session|state|cache|parser|parsing|middleware|server|client)\b|协议|传输|请求|响应|会话|状态|缓存|解析|服务端|客户端|继承|穿透|跨|全链路/;

const RISK_DOMAIN_PATTERNS = {
  security: /\b(security|auth|authentication|authorization)\b|安全|鉴权|认证|授权/i,
  payment: /\b(payment|payments|reconciliation)\b|支付|清结算|对账/i,
  production: /\b(production|prod)\b|线上|生产/i,
  funds: /\b(funds?|money|trading)\b|资金|交易/i,
  data: /\b(customer\s+data|user\s+data|database|db)\b|客户数据|用户数据|数据库/i
};

const RISK_STATE_PATTERNS = {
  dataLoss: /\bdata loss\b|数据丢失/i,
  incident: /\b(incident|outage|corruption)\b|事故|故障|宕机|损坏/i,
  vulnerability: /\b(vulnerability|bypass|leak|leakage|exposure|token)\b|漏洞|绕过|泄露|暴露|令牌/i,
  failure: /\b(issue|failure|failed|failing|error|wrong|abnormal)\b|失败|异常|错误|错账|影响/i,
  userImpact: /\b(users?|customers?|impact)\b|用户|客户|影响/i,
  rootCause: /\b(root cause|rca)\b|根因/i
};

const REVIEW_PATTERNS = {
  followUp: /review\s*(fix|change|改修|整改)/i,
  feedback: /指摘|指出的问题|修改意见|反馈意见|レビュー指摘|レビュー対応/,
  review: /\b(code\s*)?review\b/i,
  prMr: /\b(PR|MR)\b/,
  chineseReview: /审查|审核/
};

const COMPLEX_PATTERNS = {
  architecture: /\barchitecture\b/i,
  rootCauseOrMigration: /\b(root cause|migration)\b/i,
  chineseDesignOrScope: /架构|复杂调试|全链路|端到端|全仓|大规模|根因|高风险|迁移/,
  multiStepEngineering: /\b(multi-?file|cross-?module|integration|compatibility|performance|race condition|flaky|ci)\b/i,
  chineseMultiStepEngineering: /多文件|跨模块|联调|兼容|性能|竞态|偶发|流水线|CI|测试失败|CI失败/,
  refactor: /\brefactor\b/i
};

const CODING_PATTERNS = {
  taskTerm: /\b(fix|implement|bug|failing|traceback)\b/i,
  artifactTerm: /\b(tests?|logs?|api|database|sql|build|error)\b/i,
  chineseTaskTerm: /修复|实现|报错|改代码/,
  chineseArtifactTerm: /测试|日志|回测|接口|数据库|构建|失败/
};

const SIMPLE_PATTERNS = {
  explanation: /\b(explain|summarize|translate|what is|why)\b/i,
  documentation: /\breadme\b/i,
  chineseQuestion: /解释|总结|翻译|是什么|为什么|告诉我|讲一下|说明一下/,
  lightweight: /简单|快速看下/
};

export function extractFeatures(prompt) {
  const text = normalizePrompt(prompt);
  const readOnlyDetection = detectReadOnly(text);
  const shapeText = stripReadOnlySignals(text);
  const lineCount = text.split("\n").filter((line) => line.trim()).length;

  const technicalContext = {
    identifier: TECHNICAL_IDENTIFIER_PATTERN.test(shapeText),
    mixedLanguageIdentifier: MIXED_LANGUAGE_IDENTIFIER_PATTERN.test(shapeText),
    term: TECHNICAL_CONTEXT_PATTERN.test(shapeText)
  };

  const risk = matchPatternMap(shapeText, RISK_DOMAIN_PATTERNS);
  const riskState = matchPatternMap(shapeText, RISK_STATE_PATTERNS);
  const review = matchPatternMap(shapeText, REVIEW_PATTERNS);
  const complex = matchPatternMap(shapeText, COMPLEX_PATTERNS);
  const coding = matchPatternMap(shapeText, CODING_PATTERNS);
  const simple = matchPatternMap(shapeText, SIMPLE_PATTERNS);

  return {
    text,
    shapeText,
    empty: text.length === 0,
    readOnly: readOnlyDetection.readOnly,
    readOnlyReason: readOnlyDetection.reason,
    charLength: text.length,
    lineCount,
    technicalContext: {
      ...technicalContext,
      any: Object.values(technicalContext).some(Boolean)
    },
    intent: {
      investigateOrFix: INVESTIGATION_OR_FIX_INTENT_PATTERN.test(shapeText),
      change: CHANGE_INTENT_PATTERN.test(shapeText)
    },
    recurrence: {
      strong: STRONG_REGRESSION_PATTERN.test(shapeText),
      marker: RECURRENCE_MARKER_PATTERN.test(shapeText),
      negativeState: NEGATIVE_ISSUE_STATE_PATTERN.test(shapeText)
    },
    surface: {
      deepEngineering: DEEP_ENGINEERING_SURFACE_PATTERN.test(shapeText)
    },
    risk,
    riskState,
    review,
    complex,
    coding,
    simple
  };
}

export function hasRegressionOrRecurrence(features) {
  return features.recurrence.strong
    || (features.recurrence.marker && features.recurrence.negativeState);
}

function matchPatternMap(text, patterns) {
  return Object.fromEntries(
    Object.entries(patterns).map(([name, pattern]) => [name, pattern.test(text)])
  );
}
