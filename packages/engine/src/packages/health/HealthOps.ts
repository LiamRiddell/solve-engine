/**
 * Health and fitness helpers as pure functions, so each is unit-tested on its
 * own. Inputs are plain numbers in the stated units (kilograms and metres for
 * BMI; kilometres and minutes for pace and speed).
 */

/** Body mass index: weight in kilograms divided by height in metres squared. */
export function bmi(weightKg: number, heightM: number): number {
	return weightKg / (heightM * heightM);
}

/** Speed in km/h from a distance in km over a time in minutes. */
export function speedKmh(distanceKm: number, timeMin: number): number {
	return (distanceKm * 60) / timeMin;
}

/**
 * Running pace as a "m:ss" string, the minutes and seconds it takes to cover one
 * kilometre. `pace(10, 50)` is 5 minutes a kilometre, "5:00".
 */
export function pacePerKm(distanceKm: number, timeMin: number): string {
	const minPerKm = timeMin / distanceKm;
	let minutes = Math.floor(minPerKm);
	let seconds = Math.round((minPerKm - minutes) * 60);
	if (seconds === 60) { minutes += 1; seconds = 0; } // carry a rounded-up 60
	return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}
