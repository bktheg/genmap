const FACTOR_F = 100; // seems to be 100 and not 144
const FACTOR_R = 180;

const FACTOR_TALER = 30;
const FACTOR_GROSCHEN = 12;

export class Money {
    public taler:number;
    public groschen:number;
    public pfennig:number;

    constructor(taler:number, groschen:number, pfennig:number) {
        this.taler = taler || 0;
        this.groschen = groschen || 0;
        this.pfennig = pfennig || 0;
    }

    getTotalPfennig():number {
        return this.taler*FACTOR_TALER*FACTOR_GROSCHEN+this.groschen*FACTOR_GROSCHEN+this.pfennig;
    }

    rebalance():Money {
        const totalPfennig = this.getTotalPfennig();

        const pfennig = totalPfennig % FACTOR_GROSCHEN;
        let groschen = Math.floor((totalPfennig)/FACTOR_GROSCHEN);
        const taler = Math.floor(groschen/FACTOR_TALER);
        groschen = groschen % FACTOR_TALER;
        return new Money(taler, groschen, pfennig);
    }

    add(money:Money):Money {
        if( money == null ) {
            return this;
        }
        return new Money(this.taler+money.taler, this.groschen+money.groschen, this.pfennig+money.pfennig).rebalance();
    }

    mul(factor:number):Money {
        return new Money(0,0,Math.round(this.getTotalPfennig()*factor)).rebalance();
    }

    div(factor:number):Money {
        return new Money(0,0,Math.round(this.getTotalPfennig()/factor)).rebalance();
    }

    equals(money:Money):boolean {
        return money != null && money.taler == this.taler && money.groschen == this.groschen && money.pfennig == this.pfennig;
    }

    toString():string {
        const format = new Intl.NumberFormat('de-DE', {useGrouping:false})
        return `${format.format(this.taler || 0)}.${format.format(this.groschen || 0)}.${format.format(this.pfennig || 0)}`;
    }

    isZero():boolean {
        return this.taler == 0 && this.groschen == 0 && this.pfennig == 0;
    }
}

export class Area {
    public morgen:number;
    public ruten:number;
    public fuss:number;

    constructor(morgen:number, ruten:number, fuss:number) {
        this.morgen = morgen || 0;
        this.ruten = ruten || 0;
        this.fuss = fuss || 0;
    }

    getTotalFuss():number {
        return this.morgen*FACTOR_R*FACTOR_F+this.ruten*FACTOR_F+this.fuss;
    }

    getTotalMorgen():number {
        return this.getTotalFuss() / (FACTOR_R*FACTOR_F);
    }

    toMeter2():number {
        return this.getTotalFuss()/100 * 14.18457880;
    }

    rebalance():Area {
        const totalFuss = this.getTotalFuss();

        const fuss = totalFuss % FACTOR_F;
        let ruthen = Math.floor((totalFuss)/FACTOR_F);
        const morgen = Math.floor(ruthen/FACTOR_R);
        ruthen = ruthen % FACTOR_R;
        return new Area(morgen, ruthen, fuss);
    }

    add(area:Area):Area {
        if( !area ) {
            return this;
        }
        return new Area(this.morgen+area.morgen, this.ruten+area.ruten, this.fuss+area.fuss).rebalance();
    }

    subtract(area:Area):Area {
        if( !area ) {
            return this;
        }
        return new Area(this.morgen-area.morgen, this.ruten-area.ruten, this.fuss-area.fuss).rebalance();
    }

    equals(area:Area):boolean {
        return area != null && area.morgen == this.morgen && area.ruten == this.ruten && area.fuss == this.fuss;
    }

    toString():string {
        const format = new Intl.NumberFormat('de-DE', {useGrouping:false})
        return `${format.format(this.morgen || 0)}.${format.format(this.ruten || 0)}.${format.format(this.fuss || 0)}`;
    }

    isZero():boolean {
        return this.morgen == 0 && this.ruten == 0 && this.fuss == 0;
    }
}

export function parseMorgenRutenFuss(areaString:string):Area {
    if( !areaString ) {
        return null;
    }
    const parts = areaString.split('.');
    return new Area(parseInt(parts[0]), parseInt(parts[1]), parseFloat(parts[2]?.replace(',','.')));
}

export function parseMoney(moneyString:string):Money {
    if( !moneyString ) {
        return null;
    }
    const parts = moneyString.split('.');
    return new Money(parseInt(parts[0]), parseInt(parts[1]), parseInt(parts[2]));
}

export type KlasseParseResult = {
    klassenMap: Map<number,Area>;
    error: string;
}

export function parseKlasseString(klasse:string, totalArea:Area):KlasseParseResult {
    const klassenMap = new Map<number,Area>()
    const simpleKlasseMatch = klasse.match(/^([0-9]+)(?:\s*\([IVXLCDM]+\))?$/)
    if( simpleKlasseMatch ) {
        const parsedKlasse = parseInt(simpleKlasseMatch[1]);
        if( parsedKlasse < 1 || parsedKlasse > 5 ) {
            return { klassenMap: null, error: 'Ungültige Klasse: '+klasse }
        }
        klassenMap.set(parsedKlasse, totalArea)
        return { klassenMap, error: null }
    }

    const regex = /^([0-9/\.]+[mrf]\=[1-5])([\s]+[0-9/\.]+[mrf]\=[1-5])?([\s]+[0-9/\.]+[mrf]\=[1-5])?([\s]+[0-9/\.]+[mrf]\=[1-5])?(?:\srest\s([1-5]))?$/
    const matches = klasse.match(regex)
    if( !matches ) {
        return { klassenMap: null, error: 'Ungültige Klasse: '+klasse }
    }

    let remainingArea = totalArea
    for( const entry of [matches[1],matches[2], matches[3], matches[4]] ) {
        if( !entry ) {
            continue
        }
        const parts = entry.trim().split('=')
        if( parts.includes('/') ) {
            // TODO Not supported yet
            return { klassenMap: null, error: null };
        }
        const unit = parts[0].charAt(parts[0].length-1)
        let areaParts = parts[0].substring(0, parts[0].length-1).split('.')
        if( unit == 'r' ) {
            areaParts = ['0', ...areaParts]
        }
        else if( unit == 'f' ) {
            areaParts = ['0', '0', ...areaParts]
        }
        while( areaParts.length < 3 ) {
            areaParts.push('0')
        }
        if( areaParts.length > 3 ) {
            return { klassenMap: null, error: 'Ungültige Klasse: '+klasse }
        }

        const areaOfPart = parseMorgenRutenFuss(areaParts.join('.'))
        remainingArea = remainingArea.subtract(areaOfPart)
        klassenMap.set(parseInt(parts[1]), areaOfPart)
    }

    if( remainingArea.getTotalFuss() < 0 ) {
        return { klassenMap: null, error: 'Ungültige Klasse: '+klasse+'. Restfläche ist negativ' }
    }

    klassenMap.set(parseInt(matches[5]), remainingArea)
    return { klassenMap, error: null }
}

export function splitFuss(fuss:number):Area {
    return new Area(0,0,fuss).rebalance();
}

export function fussToMeter2(fuss:number):number {
    return new Area(0,0,fuss).toMeter2();
}