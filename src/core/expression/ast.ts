export type ExpressionNode =
  | LiteralNode
  | IdentifierNode
  | UnaryNode
  | BinaryNode
  | MemberNode
  | IndexNode
  | CallNode;

export interface LiteralNode {
  kind: "literal";
  value: unknown;
  raw: string;
}

export interface IdentifierNode {
  kind: "identifier";
  name: string;
}

export interface UnaryNode {
  kind: "unary";
  operator: string;
  argument: ExpressionNode;
}

export interface BinaryNode {
  kind: "binary";
  operator: string;
  left: ExpressionNode;
  right: ExpressionNode;
}

export interface MemberNode {
  kind: "member";
  object: ExpressionNode;
  property: string;
}

export interface IndexNode {
  kind: "index";
  object: ExpressionNode;
  index: ExpressionNode;
}

export interface CallNode {
  kind: "call";
  callee: ExpressionNode;
  args: ExpressionNode[];
}
