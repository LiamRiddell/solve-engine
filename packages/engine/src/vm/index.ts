export { DependencyGraph } from "./DependencyGraph";
export { ScopeManager } from "./ScopeManager";
export { Value, ValueType, numberValue, hexValue, bigIntValue, stringValue, uomValue, matrixValue, rowVectorValue, colVectorValue, rangeValue } from "./Value";
export type { MatrixData, MatrixEntry, RangeData } from "./Value";
export { createVM, executeBytecode } from "./VM";
// The allocation guard's accounting half, exported because a package
// registering its own opcode needs it: an opcode that allocates in proportion
// to user input has to charge for what it makes, and check before making
// anything whose size it can work out in advance, or it reintroduces the class
// of bug that could abort the host process. The lifecycle half (opening and
// closing an evaluation) stays internal to `executeBytecode()`.
export { chargeAllocation, checkAllocation, checkedArray } from "./AllocationBudget";
export type { Bytecode } from "./VM";
export { VMCheckpointer } from "./VMCheckpoints";
export type { VMCheckpoint } from "./VMCheckpoints";
export { builtinFunctions, pluginFunctionRegistry, allocatePluginFunctionIndex, pluginFunctionIndexFor } from "./VMBuiltins";
export { unifyUom, binaryOp } from "./VMConversion";
export { OpRegistry, sharedOpRegistry } from "./OpRegistry";
export type { VM } from "./OpRegistry";
export type { ExpressionRecord } from "./ScopeManager";
