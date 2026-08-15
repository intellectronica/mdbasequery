export { compileExpression, evaluateAst, evaluateExpression, GLOBAL_FUNCTION_NAMES } from "./evaluator.js";
export type { EvaluationContext, EvaluateOptions } from "./evaluator.js";
export { ExpressionSyntaxError, parseExpression } from "./parser.js";
export type {
  BinaryNode,
  CallNode,
  ExpressionNode,
  IdentifierNode,
  IndexNode,
  LiteralNode,
  ArrayNode,
  ObjectEntryNode,
  ObjectNode,
  MemberNode,
  UnaryNode,
} from "./ast.js";
