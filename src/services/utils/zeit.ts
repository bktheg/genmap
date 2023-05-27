export class Zeit {
    private date:Date;
    private datumEnde:Date;
    private text:string;

    constructor(datum:Date, text:string, datumEnde:Date=null) {
        this.date = datum;
        this.text = text;
        this.datumEnde = datumEnde;
    }

    compareTo(other:Zeit) {
        if( this.date > other.date ) {
            return 1;
        }
        if( this.date < other.date ) {
            return -1;
        }
        if( this.datumEnde != null ) {
            return other.datumEnde == null ? 1 : (this.datumEnde.getTime() - other.datumEnde.getTime());
        }
        return other.datumEnde != null ? -1 : 0;
    }

    getText():string {
        return this.text;
    }

    getDate():Date {
        return this.date;
    }

    getDatumEnde():Date {
        return this.datumEnde;
    }

    isUnknown():boolean{
        return this.date == null;
    }

    isRange():boolean {
        return this.datumEnde != null;
    }

    matchesYear(year:number):boolean {
        if( this.datumEnde == null ) {
            return this.date.getUTCFullYear() == year;
        }

        return this.date.getUTCFullYear() <= year && this.datumEnde.getUTCFullYear() >= year;
    }

    intersectsYearRange(startYear:number,endYear:number):boolean {
        if( this.datumEnde == null ) {
            const year = this.date.getUTCFullYear();
            return (startYear == null || startYear <= year) && (endYear == null || endYear >= year);
        }

        const ownStart = this.date.getUTCFullYear();
        const ownEnd = this.datumEnde.getUTCFullYear();
        if( startYear == null ) {
            return ownStart <= endYear;
        }
        else if( endYear == null ) {
            return ownEnd >= startYear;
        }

        return (ownStart <= startYear && ownEnd >= startYear) || (ownStart <= endYear && ownEnd >= endYear) || 
            (startYear <= ownStart && endYear >= ownStart) || (startYear <= ownEnd && endYear >= ownEnd) ;
    }

    extendTo(zeit:Zeit):Zeit {
        const o1 = zeit.date;
        const o2 = zeit.datumEnde != null ? zeit.datumEnde : zeit.date;
        const z1 = this.date;
        const z2 = this.datumEnde != null ? this.datumEnde : this.date;

        const sorted = [o1, o2, z1, z2].sort((a,b) => a < b ? -1 : (a > b ? 1 : 0));

        const date = sorted[0];
        let datumEnde = sorted[3];
        if( date == datumEnde ) {
            datumEnde = null;
        }
        return new Zeit(date, this.formatDate(date)+(datumEnde != null ? " - "+this.formatDate(datumEnde) : ""), datumEnde);
    }

    private formatDate(date:Date):string {
        return date.getUTCDate()+"."+(date.getUTCMonth()+1)+"."+date.getUTCFullYear();
    }
}

export function zeitraum(zeit1:Zeit, zeit2:Zeit, text:string) {
    // TODO
    if( zeit1 != null && !zeit1.isUnknown() ) {
        return zeitpunkt(zeit1, text);
    }
    return zeitpunkt(zeit2, text);
}


export function zeitpunkt(zeit:Zeit, text:string) {
    return new Zeit(zeit.getDate(), text);
}

class Matcher {
    regExp:RegExp;
    handler:(text:string,match:RegExpExecArray)=>Zeit;

    constructor(regExp:RegExp, handler:(text:string,match:RegExpExecArray)=>Zeit) {
        this.regExp = regExp;
        this.handler = handler;
    }
}

function replaceAll(target:string, search:string, replacement:string) {
    return target.split(search).join(replacement);
};

const matchers:Matcher[] = []

// YYYY - 1900
function parseYear(text:string, match:RegExpExecArray) {
    const date = new Date(0);
    date.setUTCFullYear(parseInt(match[1]));
    return new Zeit(date, text);
}
matchers.push(new Matcher(/^([\d]{4})(:? u. früher)?$/,parseYear));

// YYYY - 19??
function parseYearPartialUnknown(text:string, match:RegExpExecArray) {
    const date = new Date(0);
    let matchText = replaceAll(match[1], '?', '0');
    matchText = replaceAll(matchText, '.', '0');
    date.setUTCFullYear(parseInt(matchText));
    return new Zeit(date, text);
}
matchers.push(new Matcher(/^([\d]{1}[\d\.\?]{3})?$/,parseYearPartialUnknown));

// n. YYYY - 1900
function parseYearAfter(text:string, match:RegExpExecArray) {
    const date = new Date(0);
    date.setUTCFullYear(parseInt(match[1])+1);
    return new Zeit(date, text);
}
matchers.push(new Matcher(/^n[\.]? ([\d]{4})$/,parseYearAfter));


// YYYY[-/][YY]YY - 1546-58, 1752-1769, 1719/27
function parseYearRange(text:string, match:RegExpExecArray) {
    const start = parseInt(match[1]);
    let end = parseInt(match[2]);
    if( end < 100 ) {
        end += start-start % 100;
    }
    const date = new Date(0);
    date.setUTCFullYear(start);

    const dateEnd = new Date(0);
    dateEnd.setUTCFullYear(end);
    
    return new Zeit(date, text, dateEnd);
}
matchers.push(new Matcher(/^(?:um )?([\d]{4})[-/]{1}([\d]{2,4})$/,parseYearRange));


// MM.YYYY - 03.1902
function parseYearMonth(text:string, match:RegExpExecArray) {
    const date = new Date(0);
    date.setUTCFullYear(parseInt(match[2]), parseInt(match[1])-1);
    return new Zeit(date, text);
}
matchers.push(new Matcher(/^([\d]{1,2})\.([\d]{4})$/,parseYearMonth));

// DD.MM.YYYY - 01.03.1902
function parseYearMonthDay(text:string, match:RegExpExecArray) {
    const date = new Date(0);
    date.setUTCFullYear(parseInt(match[3]), parseInt(match[2])-1, parseInt(match[1]));
    return new Zeit(date, text);
}
matchers.push(new Matcher(/^([\d]{1,2})\.([\d]{1,2})\.([\d]{4})$/,parseYearMonthDay));


// DD. MMM. YYYY - 01.03.1902
function parseYearMonthTextDay(text:string, match:RegExpExecArray) {
    const monthText = match[2];
    let month = 1;
    switch(monthText.toLowerCase()) {
        case 'jan':
            month = 1;
            break;
        case 'feb':
        case 'febr':
            month = 2;
            break;
        case 'mrz':
        case 'märz':
            month = 3;
            break;
        case 'apr':
        case 'april':
            month = 4;
            break;
        case 'mai':
            month = 5;
            break; 
        case 'jun':
        case 'juni':
            month = 6;
            break;
        case 'jul':
        case 'juli':
            month = 7;
            break;
        case 'aug':
            month = 8;
            break;
        case 'sep':
        case 'sept':
            month = 9;
            break;
        case 'okt':
        case 'okto':
            month = 10;
            break;
        case 'nov':
        case 'novbr':
            month = 11;
            break;
        case 'dez':
        case 'dezbr':
            month = 12;
            break;
    }

    const date = new Date(0);
    date.setUTCFullYear(parseInt(match[3]), month-1, parseInt(match[1]));
    return new Zeit(date, text);
}
matchers.push(new Matcher(/^([\d]{1,2})[\.]? ([a-zA-Zäöü]{3,5})[\.]? ([\d]{4})$/,parseYearMonthTextDay));


export function parse(text:string) {
    const thisText = text != null ? text.trim() : null;
    if( thisText == null || thisText == "" ) {
        return null;
    }

    if( thisText == "..." || thisText == "...." || thisText == "…" || thisText == '….' ) {
        return new Zeit(null, thisText);
    }

    for( const m of matchers ) {
        const regexpMatch = m.regExp.exec(thisText);
        if( regexpMatch ) {
            return m.handler(thisText, regexpMatch);
        }
    }

    //console.log("unknown pattern "+thisText);
    return new Zeit(null, thisText);
}