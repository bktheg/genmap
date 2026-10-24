/**
 * Splits a combined Kulturart (e.g. "Haus u. Hofraum", "Haus und Hofraum", "Haus & Hofraum")
 * into its lower-cased single parts.
 */
export function splitKulturarten(art:string):string[] {
    art = art.split(" und ").join(" u. ").split(" & ").join(" u. ");
    return art.toLowerCase().split(" u.");
}
