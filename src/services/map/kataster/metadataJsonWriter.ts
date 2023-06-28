import * as fs from 'fs'
import * as wkt from 'wkt'
import * as mapReader from '#kataster/mapReader'
import * as mutterrolle from '#kataster/mutterrolle'
import * as gemeindeType from '#kataster/gemeindeType'
import * as database from '#utils/database'
import * as infoReader from '#kataster/infoReader'
import { consola } from 'consola'

const katasterPath = process.env.KATASTER_PATH

type InfoExport = {
    t:string // typ
    a:any // attributes
}

function roundCoords(coords:number[]) {
    return coords.map(c => Math.round(c*10000)/10000);
}

type AdminExport = {
    f:FlurExport[], // Fluren
    g:GemeindeExport[], // Gemeinden
    b:BuergermeistereiExport[], // Buergermeistereien
    k:KreisExport[] // Kreise
}

type BuergermeistereiExport = {
    i:string, // id
    n:string, // name
    k:string, // kreis
    a:InfoExport[] // Infos
}

type KreisExport = {
    i:string, // id
    n:string, // name
    a:InfoExport[] //
}

type GemeindeExport = {
    b:string, // Buergermeisterei
    n:string, // name
    i:string, // id
    qv:string, // quelle vermessung
    qb:string, // quelle flurbuch
    qm:string, // quelle mutterrollen
    qg:string, // quelle gueterverzeichnis
    bb:number[], // bbox
    a:InfoExport[] // Infos
}

type FlurExport = {
    g:string, // Gemeinde
    n:number, // Nr
    name:string,
    qmap:string,
    box:number[],
    lt:string
}

export async function writeMetadataAdminJson(kreise:gemeindeType.Kreis[], bgmstr:gemeindeType.Buergermeisterei[], gemeinden:gemeindeType.GemeindeId[], fluren:gemeindeType.Flur[]) {
    const info = await infoReader.readAll();

    const gemeindenExport = await generateGemeindeJsonExport(gemeinden,info);
    const bgmstrExport = await generateBuergermeistereiJsonExport(bgmstr, info);
    const kreiseExport = await generateKreisJsonExport(kreise,info);
    const flurenExport = await generateMetadataFlurenExport(fluren);

    const adminExport = {
        f: flurenExport,
        g: gemeindenExport,
        b: bgmstrExport,
        k: kreiseExport
    } as AdminExport;

    fs.writeFileSync(katasterPath+"/out_metadata/admin.json", JSON.stringify(adminExport, (k, v) => v != null ? v : undefined, 0));
}

export async function generateBuergermeistereiJsonExport(buergermeistereien:gemeindeType.Buergermeisterei[], infos:infoReader.Info[]):Promise<BuergermeistereiExport[]> {
    let out:BuergermeistereiExport[] = [];
    for( const b of buergermeistereien ) {
        if( !b.isPartsDone() ) {
            continue;
        }
        out.push({
            k: b.getKreis().getId(),
            n: b.getName(),
            i: b.getId(),
            a: infos.filter(i => i.matches(b.getKreis(),b,null,null,null)).map(i => mapInfo(i))
        })
    }

    out.sort((a,b) => {
        let diff = a.k.localeCompare(b.k);
        if( diff != 0 ) {
            return diff;
        }
        return a.n.localeCompare(b.n);
    });

    return out;
}

export async function generateKreisJsonExport(kreise:gemeindeType.Kreis[], infos:infoReader.Info[]):Promise<KreisExport[]> {
    let out:KreisExport[] = [];
    for( const k of kreise ) {
        if( !k.isPartsDone() ) {
            continue;
        }
        out.push({
            n: k.getName(),
            i: k.getId(),
            a: infos.filter(i => i.matches(k,null,null,null,null)).map(i => mapInfo(i))
        })
    }

    out.sort((a,b) => {
        return a.n.localeCompare(b.n);
    });

    return out;
}

export async function generateGemeindeJsonExport(gemeinde:gemeindeType.GemeindeId[], infos:infoReader.Info[]):Promise<GemeindeExport[]> {
    const bboxes = new Map<string,number[]>();
    const result = await database.getClient().query({
        text: "SELECT gemeinde,ST_ASTEXT(ST_TRANSFORM(ST_SETSRID(ST_EXTENT(the_geom),7416),4326)) as bbox FROM kataster_gen_areas GROUP BY gemeinde"
    })
    for( const r of result.rows ) {
        const bbox = wkt.parse(r.bbox);
        bboxes.set(r.gemeinde, bbox.coordinates[0].map(c => roundCoords(c)));
    }

    const gemeindeSorted = [...gemeinde];
    gemeindeSorted.sort((a,b) => {
        let diff = a.getParent().getKreis().getName().localeCompare(b.getParent().getKreis().getName());
        if( diff != 0 ) {
            return diff;
        }
        diff = a.getParent().getName().localeCompare(b.getParent().getName());
        if( diff != 0 ) {
            return diff;
        }
        return a.getName().localeCompare(b.getName());
    });

    let out:GemeindeExport[] = [];
    for( const g of gemeindeSorted ) {
        if( !g.isPartsDone() ) {
            continue;
        }
        const box = bboxes.get(g.getId())
        out.push({
            b: g.getParent().getId(),
            n: g.getName(),
            i: g.getId(),
            qv: g.getQuelleVermessung(),
            qb: g.getQuelleFlurbuch(),
            qm: g.getQuelleMutterrollen(),
            qg: g.getQuelleGueterverzeichnis(),
            bb: box,
            a: infos.filter(i => i.matches(g.getParent().getKreis(),g.getParent(),g,null,null)).map(i => mapInfo(i))
        })
    }

    return out;
}

export async function generateMetadataFlurenExport(flure:gemeindeType.Flur[]):Promise<FlurExport[]> {
    const bboxes = new Map<string,number[]>();
    const result = await database.getClient().query({
        text: "SELECT gemeinde,flur,ST_ASTEXT(ST_TRANSFORM(ST_SETSRID(ST_EXTENT(the_geom),7416),4326)) as bbox FROM kataster_gen_areas GROUP BY gemeinde,flur"
    })
    for( const r of result.rows ) {
        const bbox = wkt.parse(r.bbox);
        bboxes.set(r.gemeinde+"#"+r.flur, bbox.coordinates[0].map(c => roundCoords(c)));
    }

    let out:FlurExport[] = [];
    for( const f of flure ) {
        if( !f.isDone() ) {
            continue;
        }
        const box = bboxes.get(f.getGemeinde().getId()+"#"+f.getId())
        out.push({
            g: f.getGemeinde().getId(),
            n: f.getId(),
            name: f.getName(),
            qmap: f.getQuelleKarte(),
            box: box,
            lt: f.getLegalText()
        })
    }

    out.sort((a,b) => {
        let gemA = gemeindeType.forId(a.g);
        let gemB = gemeindeType.forId(b.g);
        let diff = gemA.getParent().getKreis().getName().localeCompare(gemB.getParent().getKreis().getName());
        if( diff != 0 ) {
            return diff;
        }
        diff = gemA.getParent().getName().localeCompare(gemB.getParent().getName());
        if( diff != 0 ) {
            return diff;
        }
        diff = gemA.getName().localeCompare(gemB.getName());
        if( diff != 0 ) {
            return diff;
        }
        return a.n-b.n;
    });

    return out;
}

type BezeichnungExport = {
    g:string,
    f:number,
    n:string,
    t:number,
    l:number[]
}

export async function writeMetadataBezeichnungenJson(bezeichnungen:mapReader.Bezeichnung[],strassen:mapReader.Strasse[], buildings:mapReader.Building[]) {
    let out:BezeichnungExport[] = [];
    for( const b of bezeichnungen ) {
        if( b.gemeinde.getFlur(b.flur) == null ) {
            consola.error(`Unbekannte Flur ${b.flur} in Gemeinde ${b.gemeinde.getId()} gefunden beim Schreiben der Bezeichnung '${b.name}'`);
            continue;
        }
        if( !b.gemeinde.getFlur(b.flur).isDone() || b.location[0] == 0 || b.location[1] == 0 ) {
            continue;
        }
        out.push({
            g: b.gemeinde.getId(),
            f: b.flur,
            n: b.name,
            t: b.type,
            l: roundCoords(b.location)
        })
    }

    for( const s of strassen ) {
        // Ignore streets, keep water/names
        if( s.type == null ) {
            continue;
        }
        if( (s.flur != null && !s.gemeinde.getFlur(s.flur).isDone()) || s.location[0] == 0 || s.location[1] == 0 ) {
            continue;
        }
        out.push({
            g: s.gemeinde.getId(),
            f: s.flur,
            n: s.name,
            t: s.type+100,
            l: roundCoords(s.location)
        })
    }

    for( const b of buildings ) {
        if( (b.flur != null && !b.gemeinde.getFlur(b.flur).isDone()) || b.location[0] == 0 || b.location[1] == 0 ) {
            continue;
        }
        out.push({
            g: b.gemeinde.getId(),
            f: b.flur,
            n: b.bezeichnung,
            t: 50,
            l: roundCoords(b.location)
        })
    }

    fs.writeFileSync(katasterPath+"/out_metadata/bezeichnungen.json", JSON.stringify(out, (k, v) => v != null ? v : undefined, 0));
}

type EigentuemerExport = {
    id:string,
    n:string
}

export async function writeMutterrollenEigentuemer(eigentuemer:mutterrolle.Mutterrolle[]) {
    const out = {};

    for( const e of eigentuemer ) {
        if( !out[e.gemeinde.getId()] ) {
            out[e.gemeinde.getId()] = [];
        }
        out[e.gemeinde.getId()].push({
            id:e.artikelNr,
            n:e.name
        }) as EigentuemerExport;
    }
    fs.writeFileSync(katasterPath+"/out_metadata/eigentuemer.json", JSON.stringify(out, (k, v) => v != null ? v : undefined, 0));
}

type MutterrolleRowExport = {
    f:number, // flurNr
    a:string, // flaeche
    k:string, // klasse
    t:string, // kulturart
    l:string, // lage
    p:string, // parzelle
    e:string, // reinertrag
    x:number[] // coords
}

type MutterrolleExport = {
    n:string,
    r:MutterrolleRowExport[]
}

export async function writeMutterrollen(gemeinde:gemeindeType.GemeindeId, mutterrollen:mutterrolle.Mutterrolle[]) {
    const out = {};

    for( const e of mutterrollen ) {
        const mappedRows:MutterrolleRowExport[] = e.rows.map(row => {
            return {f:row.flurNr, a:row.flaeche, k:row.klasse, t:row.kulturart, l:row.lage, p:row.parzelle, e:gemeinde.isExportReinertrag() ? row.reinertrag : null, x:roundCoords(row.location)}
        });
        out[e.artikelNr] = {
            n:e.name,
            r:mappedRows
        } as MutterrolleExport;
    }
    fs.writeFileSync(katasterPath+"/out_metadata/mutterrollen_"+gemeinde.getId()+".json", JSON.stringify(out, (k, v) => v != null ? v : undefined, 0));
}

type ParzelleBuildingExport = {
    b:string, // Bezeichnung
    n:string // hnr
}

type ParzelleExport = {
    n:string, // nr
    f:string, // flaeche
    r:string, // reinertrag
    e:string, // eigentuemer
    a:string, // mutterrolle (artikel)
    k:string, // klasse
    l:string, // lage,
    t:string, // typ
    p:number[],// position
    i:InfoExport[], // infos
    b:ParzelleBuildingExport[] // buildings
}

export async function writeMetadataParzellen(gemeinde:gemeindeType.GemeindeId, flur:number, parzellen:mapReader.Parzelle[]) {
    const out = [];

    for( const e of parzellen ) {
        const info = e.getInfo();
        const infoExport = info.map(i => mapInfo(i)).filter(i => i != null);

        out.push({
            n:e.nr,
            r:gemeinde.isExportReinertrag() ? e.reinertrag : null,
            f:e.flaeche,
            e:e.eigentuemer,
            a:e.mutterrolle,
            k:e.klasse,
            l:e.lage,
            t:e.typ,
            i:infoExport,
            p:roundCoords(e.location),
            b: e.buildings != null ? e.buildings.map(b => {return {b:b.bezeichnung, n:b.hnr} as ParzelleBuildingExport}) : null
        } as ParzelleExport);
    }
    fs.writeFileSync(katasterPath+"/out_metadata/parzellen_"+gemeinde.getId()+"_"+flur+".json", JSON.stringify(out, (k, v) => v != null ? v : undefined, 0));
}

function mapInfo(info:infoReader.Info):InfoExport {
    if( info instanceof infoReader.WikipediaInfo ) {
        return {
            t:info.type,
            a:{page:info.page}
        };
    }
    else if( info instanceof infoReader.CommonInfo ) {
        return {
            t:info.type,
            a:{t:info.info, s:info.source, u:info.url}
        }
    }
    else if( info instanceof infoReader.HaeuserbuchInfo ) {
        return {
            t:info.type,
            a:{
                i:info.infos.map(i => {return {e:i.type, t:i.text}}), 
                o:info.ownerList?.map(i => {return {y:i.year.getText(), t:i.text}}),
                y:info.additionalInfos?.map(i => {return {y:i.year?.getText(), t:i.text}}),
                a:info.address
            }
        }
    }
    return null;
}

type AllParzellenExport = {
    n:string, // nr
    a:string, // mutterrolle (artikel)
    p:number[]// position
}

export async function writeMetadataAllParzellen(parzellen:mapReader.Parzelle[]) {
    const out = {};

    for( const e of parzellen ) {
        if( !out[e.gemeinde.getId()] ) {
            out[e.gemeinde.getId()] = {}
        }
        if( !out[e.gemeinde.getId()][e.flur] ) {
            out[e.gemeinde.getId()][e.flur] = []
        }
        out[e.gemeinde.getId()][e.flur].push({
            n:e.nr,
            a:e.mutterrolle,
            p:roundCoords(e.location)
        } as AllParzellenExport);
    }
    fs.writeFileSync(katasterPath+"/out_metadata/allparzellen.json", JSON.stringify(out, (k, v) => v != null ? v : undefined, 0));
}