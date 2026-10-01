import { InfixParselet } from "@solve-js/parser/Parselet";
import { Parser } from "@solve-js/parser/Parser";
import { Token } from "@solve-js/lexer/Token";
import { BytecodeBuilder } from "@solve-js/parser/BytecodeBuilder";
import { OpCode } from "@solve-js/parser/OpCode";
import { BindingPower } from "@solve-js/parser/BindingPower";
import { ErrorFactory } from "@solve-js/errors/UnifiedErrorFramework";
import { ZONE_LOOKUP } from "../timezones/CityZones";
import { checkZoneCount, consumeZoneList, emitNamedZones, zoneDisplayName } from "./shared/ZoneReference";
import { ZONE_CONVERT_NAMED_FN } from "./TimezonePluginFunctions";
import { emitBuiltinPluginCall } from "@solve-js/packages/SynchronousPluginFunctions";

/**
 * `t London in Tokyo`: the time before the zone, read as that zone's wall
 * clock, converted into each zone after `in`. The left operand is whatever
 * came before the `ZONE_SOURCE` token that `zoneAfterNameNormalizerRule`
 * retyped the zone name to, a variable or a bracketed expression.
 *
 * Binds at `Postfix`, so the zone belongs to the time directly before it, as
 * a unit belongs to its number. The targets are read by the same list reader
 * the clock-time form uses (`in Tokyo, New York and Sydney`).
 */
export class ZoneSourceParselet implements InfixParselet {
	readonly category = "Time";
	readonly bindingPower = BindingPower.Postfix;

	parse(parser: Parser, _left: Token, token: Token, builder: BytecodeBuilder): void {
		const lower = token.value.toLowerCase();
		const zoneRef = Object.prototype.hasOwnProperty.call(ZONE_LOOKUP, lower) ? ZONE_LOOKUP[lower] : undefined;
		// The normaliser retypes a zone name only when the table lists it, so
		// this is a table lookup that cannot miss; refused rather than assumed.
		if (zoneRef === undefined) {
			throw ErrorFactory.parsing("TIME_ZONE_UNKNOWN", `"${token.value}" is not a time zone this engine knows. Name a city ("Tokyo"), a standard abbreviation ("JST") or an offset ("UTC+9")`);
		}
		parser.consume("IN");
		const targets = consumeZoneList(parser);
		if (targets.length === 0) {
			throw ErrorFactory.parsing("TIME_ZONE_EXPECTED_TARGET", `Expected a city or zone name after "in" (e.g. "6pm Sydney in Chicago")`);
		}
		checkZoneCount(targets);

		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(zoneRef);
		builder.emitOpcode(OpCode.PUSH_STRING);
		builder.emitString(zoneDisplayName(token.value));
		emitNamedZones(builder, targets);
		emitBuiltinPluginCall(builder, ZONE_CONVERT_NAMED_FN, 3 + targets.length * 2);
	}
}
