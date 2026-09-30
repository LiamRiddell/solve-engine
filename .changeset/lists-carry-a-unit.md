---
"solve-engine": minor
---

A bracketed list carries one unit: `[1 km, 500 m] * 2` is `[2.00 km, 1.00 km]`, a list of money shows as money, and a sweep of a money line answers money

A list cell held one number, so a quantity's unit was dropped as the cell was stored: `[1 km, 2 km] * 2` answered `[2, 4]`, and a list in two units of one measure was refused because both could not survive (#745). A list now keeps one unit beside its numbers, taken from its first quantity cell the way the comma aggregates take theirs, and every later cell is read in it: a quantity is converted, and a bare number is taken to be in the unit already.

| line | before | now |
| --- | --- | --- |
| `[1 km, 500 m] * 2` | `A list cannot hold quantities in km and m side by side: ...` | `[2.00 km, 1.00 km]` |
| `[1 km, 500 m][1]` | the same refusal | `0.50 km` |
| `[1 km, 2 km] * 2` | `[2, 4]` | `[2.00 km, 4.00 km]` |
| `[$5, $6] * 2` | `[10, 12]` | `[$10.00, $12.00]` |
| `[1, 2, 3] km` | `A bracketed list has no single amount to convert to km: ...` | `[1.00 km, 2.00 km, 3.00 km]` |
| `[1 km, 500 m] in m` | the two-units refusal | `[1,000.00 m, 500.00 m]` |
| `[1, 2] * 1 km` | `A bracketed list and a quantity in km cannot be multiplied: ...` | `[1.00 km, 2.00 km]` |
| `line 3 for price from $100 to $300 step $50` | `[300, 450, 600, 750, 900]` | `[$300.00, $450.00, $600.00, $750.00, $900.00]` |
| `-[1, 2]` | `0` | `[-1, -2]` |

Arithmetic keeps the unit: scaling by a number, adding or taking away a quantity or a list of the same measure. `in` and a unit written after a list convert every cell, indexing and slicing answer quantities, `map` and `reduce` hand each cell over as the quantity it is, `transpose` and `shuffle` keep the unit, cell-by-cell comparisons read both lists in one unit, and a cash-flow list of money keeps its currency. The unit travels in `Value.toJSON`, the snapshot format and the worker DTO (`matrix.unit`), each written only when a list has one, so a plain list's serialised form is unchanged.

Refused by name: cells of different measures, or money in two currencies (`MATRIX_CELL_UNITS_DIFFER`); a true or false, a percentage or a formula beside a quantity (`MATRIX_CELL_NO_UNIT`); multiplying a list of quantities by another quantity, dividing a number by one, and adding a percentage to one (`MATRIX_UNIT_OPERATION_UNSUPPORTED`); and matrix algebra on quantities, a determinant, an inverse, a matrix product or power, a dot product (`MATRIX_UNIT_ALGEBRA`).

The boundary: a list carries one unit, so an operation whose cells would come out in a power of the unit, or in two units, is refused rather than answered in plain numbers; that is the unit algebra of a matrix of quantities, which is out of scope. A symbolic cell has no unit. Plain-number lists are unchanged. Goal seek still names each answer when an unknown in a unit has several, rather than listing them. Specs that pinned the earlier refusals (`Issue640`, `Issue641`, `NonNumericOperands`, `Geo` and `WhatIf`) were updated to the new answers, and the vectors, what-if, converting-units and goal-seek pages describe lists with units.

## Verification

`Issue745_listsCarryAUnit.spec.ts` holds 73 tests: the issue's lines, every form above, the refusals, unit tests of `matrixValue`, `listCellValue`, `listFromCells`, `cellMeasuresDiffer`, `needsUnitCells`, `unitListArithmetic`, `listConverted`, `alignForComparison`, `unitListCompare`, `unitListAlgebraRefused`, `determinant`, `transpose`, `collectionToValues`, the aligned grid, the worker value and `toJSON`, a snapshot round trip, and adversarial cases: numeric edges, a conversion below the display budget, prototype words as the unit, text edges, a list of a thousand quantities, lists from variables and line references through both passes, a sweep whose answers change unit, a what-if and a check through a list, and three hundred lines of lists. The adversarial sweep gains the list templates. `executeBytecode` measures 52,765 bytecode bytes on this machine, under the 58,000 margin. The fast suite (`npm run test:ci`), the type checks, the lints and the proven docs examples passed.
