import * as database from '#utils/database'
import {PointDescriptor, PointType} from '#kataster/pointDescriptors'
import { Zeit } from '#utils/zeit';
import * as gemeindeType from '#kataster/gemeindeType'
import { consola } from 'consola';
import { createRawDataReader, Strasse, Bezeichnung, GeoJsonGeometry } from '#kataster/rawDataReader';

const SRS = "7416";

export class CalculatedArea {
    rings:PointDescriptor[][];
    gemeinde:gemeindeType.GemeindeId;
    flur:number;
    nr:string;
    validFrom:Zeit;
    validTill:Zeit;
    typ:number;
    fortschreibung:string

    constructor(gemeinde:gemeindeType.GemeindeId, flur:number, nr:string) {
        this.gemeinde = gemeinde;
        this.flur = flur;
        this.nr = nr;
        this.rings = [];
    }
}


export class CalculatedFlur {
    constructor(public flur:string, public points:PointDescriptor[]) {}
}


export class CalculatedBuilding {
    points:PointDescriptor[];
    flur:number;
    parzelle:string;
    validFrom:Zeit;
    validTill:Zeit;
    fortschreibung:string

    constructor(public gemeinde:gemeindeType.GemeindeId, flur:number, parzelle:string, public bezeichnung:string, public hnr:string) {
        this.flur = flur;
        this.parzelle = parzelle;
        this.points = [];
    }
}

export async function cleanUpGemeinde(gemeinde:gemeindeType.GemeindeId) {
    await cleanupFlure();

    consola.debug("Lösche Daten für Gemeinde aus PostGIS", gemeinde?.getId())

    await database.getClient().query({
        text: `DELETE FROM kataster_gen_points WHERE gemeinde=$1;`,
        values:[gemeinde.getId()]
    });
    await database.getClient().query({
        text: `DELETE FROM kataster_gen_areas WHERE gemeinde=$1;`,
        values:[gemeinde.getId()]
    });
    await database.getClient().query({
        text: `DELETE FROM kataster_gen_buildings WHERE gemeinde=$1;`,
        values:[gemeinde.getId()]
    });
    await database.getClient().query({
        text: `DELETE FROM kataster_gen_bezeichnungen WHERE gemeinde=$1;`,
        values:[gemeinde.getId()]
    });
    await database.getClient().query({
        text: `DELETE FROM kataster_gen_strassen WHERE gemeinde=$1;`,
        values:[gemeinde.getId()]
    });
    await cleanUpUrkatasterInfoForGemeinde(gemeinde);
}

export async function cleanUpUrkatasterInfoForGemeinde(gemeinde:gemeindeType.GemeindeId) {
    consola.debug("Lösche Daten aus kataster_urkataster_info für Gemeinde", gemeinde?.getId())

    if( gemeinde != null ) {
        await database.getClient().query({
            text: `DELETE FROM kataster_urkataster_info WHERE gemeinde=$1;`,
            values:[gemeinde.getId()]
        });
    }
    else {
        await database.getClient().query({
            text: `DELETE FROM kataster_urkataster_info`
        });
    }
}


export async function cleanUp() {
    consola.start("Lösche existierende Datenbanktabellen...");
    await database.getClient().query({
        text: `DROP VIEW IF EXISTS kataster_areas_1826;`
    });
    await database.getClient().query({
        text: `DROP VIEW IF EXISTS kataster_buildings_1826;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_gen_points;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_gen_areas;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_gen_buildings;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_gen_fluren;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_gen_admin;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_gen_bezeichnungen;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_gen_strassen;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_urkataster_info;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_metadata_fluren;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_metadata_gemeinden;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_metadata_buergermeistereien;`
    });
    await database.getClient().query({
        text: `DROP TABLE IF EXISTS kataster_metadata_kreise;`
    });

    consola.start("Erzeuge neue Datenbanktabellen...");

    consola.debug("Erzeuge Tabelle kataster_gen_points")

    await database.getClient().query({
        text: `CREATE TABLE kataster_gen_points ( 
            id VARCHAR(60) PRIMARY KEY,
            typ VARCHAR(3),
            gemeinde VARCHAR(64)
          );`
    });  

    await database.getClient().query({
        text: `SELECT AddGeometryColumn('kataster_gen_points','the_geom',$1,'POINT',2);`,
        values: [SRS]
    });

    await database.getClient().query({
        text: `CREATE INDEX kataster_gen_points_geo_idx ON kataster_gen_points USING gist (the_geom);`
    });

    consola.debug("Erzeuge Tabelle kataster_gen_areas")

    await database.getClient().query({
        text: `CREATE TABLE kataster_gen_areas ( 
            id SERIAL PRIMARY KEY,
            gemeinde VARCHAR(64),
            flur SMALLINT,
            nr VARCHAR(30),
            yearFrom SMALLINT,
            yearTill SMALLINT,
            typ SMALLINT,
            fortschreibung VARCHAR(255)
          );`
    });

    await database.getClient().query({
        text: `SELECT AddGeometryColumn('kataster_gen_areas','the_geom',$1,'POLYGON',2);`,
        values: [SRS]
    });

    await database.getClient().query({
        text: `CREATE INDEX kataster_gen_areas_geo_idx ON kataster_gen_areas USING gist (the_geom);`
    });

    await database.getClient().query({
        text: `CREATE INDEX kataster_gen_areas_admin_idx ON kataster_gen_areas (gemeinde,flur,nr,fortschreibung);`
    });

    consola.debug("Erzeuge Tabelle kataster_gen_buildings")

    await database.getClient().query({
        text: `CREATE TABLE kataster_gen_buildings ( 
            id SERIAL PRIMARY KEY,
            gemeinde VARCHAR(64),
            flur SMALLINT,
            nr VARCHAR(30),
            yearFrom SMALLINT,
            yearTill SMALLINT,
            bezeichnung VARCHAR(32),
            hnr VARCHAR(16),
            fortschreibung VARCHAR(255)
          );`
    });

    await database.getClient().query({
        text: `SELECT AddGeometryColumn('kataster_gen_buildings','the_geom',$1,'POLYGON',2);`,
        values: [SRS]
    });

    await database.getClient().query({
        text: `CREATE INDEX kataster_gen_buildings_geo_idx ON kataster_gen_buildings USING gist (the_geom);`
    });

    await database.getClient().query({
        text: `CREATE INDEX kataster_gen_buildings_admin_idx ON kataster_gen_buildings (gemeinde,flur,nr,fortschreibung);`
    });

    consola.debug("Erzeuge Tabelle kataster_gen_fluren")

    await database.getClient().query({
        text: `CREATE TABLE kataster_gen_fluren ( 
            id SERIAL PRIMARY KEY,
            flur VARCHAR(64)
          );`
    });

    await database.getClient().query({
        text: `SELECT AddGeometryColumn('kataster_gen_fluren','the_geom',$1,'POLYGON',2);`,
        values: [SRS]
    });

    consola.debug("Erzeuge Tabelle kataster_gen_bezeichnungen")

    await database.getClient().query({
        text: `CREATE TABLE kataster_gen_bezeichnungen ( 
            id SERIAL PRIMARY KEY,
            name VARCHAR(255),
            gemeinde VARCHAR(64),
            flur SMALLINT,
            typ SMALLINT
          );`
    })
    await database.getClient().query({
        text: `SELECT AddGeometryColumn('kataster_gen_bezeichnungen','the_geom',$1,'POINT',2);`,
        values: [SRS]
    });

    consola.debug("Erzeuge Tabelle kataster_gen_strassen")

    await database.getClient().query({
        text: `CREATE TABLE kataster_gen_strassen ( 
            id SERIAL PRIMARY KEY,
            name VARCHAR(255),
            gemeinde VARCHAR(64),
            flur SMALLINT,
            type SMALLINT,
            anmerkung VARCHAR(255)
          );`
    })
    await database.getClient().query({
        text: `SELECT AddGeometryColumn('kataster_gen_strassen','the_geom',$1,'LINESTRING',2);`,
        values: [SRS]
    });

    consola.debug("Erzeuge Tabelle kataster_urkataster_info")

    await database.getClient().query({
        text: `CREATE TABLE kataster_urkataster_info ( 
            id SERIAL PRIMARY KEY,
            gemeinde VARCHAR(64),
            flur SMALLINT,
            nr VARCHAR(30),
            flaeche VARCHAR(128),
            reinertrag VARCHAR(128),
            mutterrolle VARCHAR(8),
            eigentuemer VARCHAR(128),
            typPlain VARCHAR(64),
            lage VARCHAR(128),
            klasse VARCHAR(64)
          );`
    });

    consola.debug("Erzeuge View kataster_areas_1826")

    await database.getClient().query({
        text: `CREATE OR REPLACE VIEW kataster_areas_1826 AS 
            SELECT k.id,k.gemeinde as gemeinde,k.flur as flur,k.nr as nr,i.flaeche as flaeche,i.reinertrag as reinertrag,i.mutterrolle as mutterrolle,i.eigentuemer as eigentuemer,i.typPlain as typPlain,k.the_geom as the_geom,k.typ as typ,i.lage as lage,i.klasse as klasse 
            FROM kataster_gen_areas as k LEFT JOIN kataster_urkataster_info as i ON k.gemeinde=i.gemeinde AND k.flur=i.flur AND k.nr=i.nr
            WHERE k.fortschreibung is null`
    });

    consola.debug("Erzeuge View kataster_buildings_1826")

    await database.getClient().query({
        text: `CREATE OR REPLACE VIEW kataster_buildings_1826 AS 
            SELECT k.id,k.gemeinde as gemeinde,k.flur as flur,k.nr as nr,k.bezeichnung as bezeichnung,k.hnr as hnr,k.the_geom
            FROM kataster_gen_buildings as k
            WHERE k.fortschreibung is null`
    });

    await database.getClient().query({
        text: `CREATE UNIQUE INDEX kataster_urkataster_info_key ON kataster_urkataster_info (gemeinde, flur, nr);`
    });

    consola.debug("Erzeuge Tabelle kataster_gen_admin")

    await database.getClient().query({
        text: `CREATE TABLE kataster_gen_admin ( 
            id VARCHAR(32),
            type VARCHAR(32),
            name VARCHAR(32),
            CONSTRAINT kataster_gen_admin_pk PRIMARY KEY (id,type)
          );`
    });

    await database.getClient().query({
        text: `SELECT AddGeometryColumn('kataster_gen_admin','the_geom',$1,'MULTIPOLYGON',2);`,
        values: [SRS]
    });

    consola.debug("Erzeuge Tabelle kataster_metadata_fluren")

    await database.getClient().query({
        text: `CREATE TABLE kataster_metadata_fluren ( 
            id INTEGER,
            gemeinde VARCHAR(64),
            name VARCHAR(128),
            done BOOLEAN,
            CONSTRAINT kataster_metadata_fluren_pk PRIMARY KEY (id,gemeinde)
          );`
    });

    consola.debug("Erzeuge Tabelle kataster_metadata_gemeinden")

    await database.getClient().query({
        text: `CREATE TABLE kataster_metadata_gemeinden ( 
            id VARCHAR(32),
            buergermeisterei VARCHAR(32),
            name VARCHAR(128),
            CONSTRAINT kataster_metadata_gemeinden_pk PRIMARY KEY (id)
          );`
    });

    consola.debug("Erzeuge Tabelle kataster_metadata_buergermeistereien")

    await database.getClient().query({
        text: `CREATE TABLE kataster_metadata_buergermeistereien ( 
            id VARCHAR(32),
            kreis VARCHAR(32),
            name VARCHAR(128),
            CONSTRAINT kataster_metadata_buergermeistereien_pk PRIMARY KEY (id)
          );`
    });

    consola.debug("Erzeuge Tabelle kataster_metadata_kreise")

    await database.getClient().query({
        text: `CREATE TABLE kataster_metadata_kreise( 
            id VARCHAR(32),
            name VARCHAR(128),
            CONSTRAINT kataster_metadata_kreise_pk PRIMARY KEY (id)
          );`
    });
}

export async function cleanupPointsOfType(type:PointType) {
    consola.debug("Lösche Punkte vom Typ", type, "aus PostGIS")

    await database.getClient().query({
        text: `DELETE FROM kataster_gen_points WHERE typ=$1`,
        values: [pointType(type)]
    });
}

export async function cleanupFlure() {
    consola.debug("Lösche Fluren aus PostGIS")

    await database.getClient().query({
        text: `DELETE FROM kataster_gen_fluren`
    });
}

export async function cleanupMetadata() {
    consola.debug("Lösche Metadaten aus PostGIS")

    await database.getClient().query({
        text: `DELETE FROM kataster_metadata_fluren`
    });
    await database.getClient().query({
        text: `DELETE FROM kataster_metadata_gemeinden`
    });
    await database.getClient().query({
        text: `DELETE FROM kataster_metadata_buergermeistereien`
    });
    await database.getClient().query({
        text: `DELETE FROM kataster_metadata_kreise`
    });
    await database.getClient().query({
        text: `DELETE FROM kataster_gen_admin`
    });
}

export async function writePoints(points:PointDescriptor[]) {
    const max = 2048;
    if( points.length > max ) {
        for( let i=0; i<points.length; i+=max ) {
            await writePoints(points.slice(i, i+max));
        }
        return;
    }

    if(points.length == 0) {
        return;
    }

    consola.debug("Schreibe", points.length, "Punkte nach kataster_gen_points")

    let query = "INSERT INTO kataster_gen_points (id,typ,gemeinde,the_geom) VALUES ";
    let values = [];
    let idx = 1;
    for( let i=0; i < points.length; i++ ) {
        query += "($"+(idx++)+",$"+(idx++)+",$"+(idx++)+",ST_SetSRID(ST_MakePoint($"+(idx++)+", $"+(idx++)+"),"+SRS+"))";
        if( i < points.length-1 ) {
            query += ",";
        }
        if( points[i].id.length > 60 ) {
            consola.error("Kann Punkt ", points[i].id, " nicht schreiben. Die ID ist mehr als 60 Zeichen lang.")
            throw new Error("ID of point to long: "+points[i].id)
        }
        values.push(points[i].id);
        values.push(pointType(points[i].type));
        values.push(points[i].gemeinde != null ? points[i].gemeinde.getId() : null);
        const pos = points[i].getPosition();
        if( pos == null ) {
            consola.error("Kann Punkt ", points[i].id, " nicht schreiben. Keine Koordinaten vorhanden.")
            throw new Error("ID of point missing: "+points[i].id)
        }
        values.push(pos[0]);
        values.push(pos[1]);
    }

    await database.getClient().query({
        text: query+";", 
        values: values
    })
}

function pointType(type:PointType):string {
    switch(type) {
    case PointType.BUILDING:
        return "G";
    case PointType.HELPER:
        return "H";
    case PointType.NET:
        return "N";
    case PointType.NET_MERIDIAN:
        return "NM";
    case PointType.PROPERTY:
        return "A";
    default:
        return "NA";
    }
}

export async function writeFluren(areas:CalculatedFlur[]) {
    if( areas.length == 0 ) {
        return;
    }

    consola.debug("Schreibe", areas.length, "Fluren nach kataster_gen_fluren")

    let query = "INSERT INTO kataster_gen_fluren (flur,the_geom) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const a of areas ) {
        if( a.points.length == 0 ) {
            consola.warn("Flur ohne Fläche gefunden: ", a.flur, ". Die Flur wird nicht geschrieben.");
            continue;
        }
        const part = "($"+(idx++)+",ST_SetSRID(ST_MakePolygon(ST_GeomFromText($"+(idx++)+")),"+SRS+"))";
        values.push(a.flur);
        values.push('LINESTRING('+a.points.map(p => `${p.getPosition()[0]} ${p.getPosition()[1]}`).join(',')+`,${a.points[0].getPosition()[0]} ${a.points[0].getPosition()[1]})`);
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })
}


export async function writeAreas(areas:CalculatedArea[]) {
    const BATCH_SIZE = 4096
    if( areas.length > BATCH_SIZE ) {
        for( let i=0; i<areas.length; i+=BATCH_SIZE ) {
            await writeAreas(areas.slice(i, i+BATCH_SIZE));
        }
        return;
    }
    if( areas.length == 0 ) {
        return;
    }

    consola.debug("Schreibe", areas.length, "Parzellen nach kataster_gen_areas")

    let query = "INSERT INTO kataster_gen_areas (gemeinde,flur,nr,yearFrom,yearTill,typ,fortschreibung,the_geom) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const a of areas ) {
        if( !validRings(a.rings) ) {
            consola.warn("Überspringe Parzelle ",a.flur, a.nr, ". Polygon ist leer.");
            continue;
        }

        let part = "($"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++);
        if( a.rings.length == 1 ) {
            part += ",ST_SetSRID(ST_MakePolygon(ST_GeomFromText($"+(idx++)+")),"+SRS+"))";
        }
        else {
            part += ",ST_SetSRID(ST_MakePolygon(ST_GeomFromText($"+(idx++)+"),ARRAY[";
            for(let i=1; i < a.rings.length; i++ ) {
                part += "ST_GeomFromText($"+(idx++)+")";
                if( i < a.rings.length-1 ) {
                    part += ","
                }
            }
            part += "]),"+SRS+"))";
        }

        values.push(a.gemeinde.getId());
        values.push(a.flur);
        values.push(a.nr);
        values.push(a.validFrom.getDate().getUTCFullYear());
        values.push(a.validTill.getDate().getUTCFullYear()-1);
        values.push(a.typ);
        values.push(a.fortschreibung);
        for( const ring of a.rings ) {
            values.push('LINESTRING('+ring.map(p => `${p.getPosition()[0]} ${p.getPosition()[1]}`).join(',')+`,${ring[0].getPosition()[0]} ${ring[0].getPosition()[1]})`);
        }
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })
}

function validRings(rings:PointDescriptor[][]):boolean {
    for( const ring of rings ) {
        if( ring.length < 3 ) {
            return false;
        }
    }
    return true;
}

export async function writeBuildings(buildings:CalculatedBuilding[]) {
    if( buildings.length == 0 ) {
        return;
    }
    if( buildings.length > 4096 ) {
        for( let i=0; i<buildings.length; i+=4096 ) {
            await writeBuildings(buildings.slice(i, i+4096));
        }
        return;
    }

    consola.debug("Schreibe", buildings.length, "Gebäude nach kataster_gen_buildings")

    let query = "INSERT INTO kataster_gen_buildings (gemeinde,flur,nr,yearFrom,yearTill,bezeichnung,hnr,fortschreibung,the_geom) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const a of buildings ) {
        if( a.points.length < 3 ) {
            consola.warn("Überspringe Gebäude", a.flur, a.parzelle, ". Polygon ist leer.");
            continue;
        }

        const part = "($"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+",ST_SetSRID(ST_MakePolygon(ST_GeomFromText($"+(idx++)+")),"+SRS+"))";
        values.push(a.gemeinde.getId());
        values.push(a.flur);
        values.push(a.parzelle);
        values.push(a.validFrom.getDate().getUTCFullYear());
        values.push(a.validTill.getDate().getUTCFullYear()-1);
        values.push(a.bezeichnung);
        values.push(a.hnr);
        values.push(a.fortschreibung);
        values.push('LINESTRING('+a.points.map(p => `${p.getPosition()[0]} ${p.getPosition()[1]}`).join(',')+`,${a.points[0].getPosition()[0]} ${a.points[0].getPosition()[1]})`);
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })
}

export async function writeMetadataFluren(fluren:gemeindeType.Flur[]) {
    if( fluren.length == 0 ) {
        return;
    }
    
    consola.debug("Schreibe", fluren.length, "Flurmetadaten nach kataster_metadata_fluren")

    let query = "INSERT INTO kataster_metadata_fluren (id,gemeinde,name,done) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const a of fluren ) {
        const part = "($"+(idx++)+",$"+(idx++)+",$"+(idx++)+",$"+(idx++)+")";
        values.push(a.getId(), a.getGemeinde().getId(), a.getName(), a.isDone());
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })
}

export async function writeMetadataGemeinden(gemeinden:gemeindeType.GemeindeId[]) {
    if( gemeinden.length == 0 ) {
        return;
    }

    consola.debug("Schreibe", gemeinden.length, "Gemeinden nach kataster_metadata_gemeinden")

    let query = "INSERT INTO kataster_metadata_gemeinden (id,buergermeisterei,name) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const a of gemeinden ) {
        const part = "($"+(idx++)+",$"+(idx++)+",$"+(idx++)+")";
        values.push(a.getId(), a.getParent().getId(), a.getName());
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })
}

export async function writeMetadataBuergermeistereien(buergermeistereien:gemeindeType.Buergermeisterei[]) {
    if( buergermeistereien.length == 0 ) {
        return;
    }

    consola.debug("Schreibe", buergermeistereien.length, "Bürgermeistereien nach kataster_metadata_buergermeistereien")

    let query = "INSERT INTO kataster_metadata_buergermeistereien (id,kreis,name) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const a of buergermeistereien ) {
        const part = "($"+(idx++)+",$"+(idx++)+",$"+(idx++)+")";
        values.push(a.getId(), a.getKreis().getId(), a.getName());
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })
}

export async function writeMetadataKreise(kreise:gemeindeType.Kreis[]) {
    if( kreise.length == 0 ) {
        return;
    }

    consola.debug("Schreibe", kreise.length, "Kreise nach kataster_metadata_kreise")

    let query = "INSERT INTO kataster_metadata_kreise (id,name) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const a of kreise ) {
        const part = "($"+(idx++)+",$"+(idx++)+")";
        values.push(a.getId(), a.getName());
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })
}

export async function generateAdminAreas() {
    let grenzen:Map<gemeindeType.GemeindeId,GeoJsonGeometry>;
    const reader = await createRawDataReader()
    try {
        grenzen = await reader.readGemeindegrenzen()
    }
    finally {
        reader.close()
    }

    if(grenzen.size <= 0) {
        return
    }

    let query = "INSERT INTO kataster_gen_admin (id,type,name,the_geom) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const entry of grenzen.entries() ) {
        if( !entry[0].isPartsDone() ) {
            continue
        }
        const part = `($${idx++},'gemeinde',$${idx++},ST_Multi(ST_SetSRID(ST_GeomFromGeoJSON($${idx++}),${SRS})))`;
        values.push(entry[0].getId(), entry[0].getName(), JSON.stringify(entry[1]));
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })

    consola.debug(grenzen.size, "Gemeindegrenzen nach kataster_gen_admin geschrieben")

    await database.getClient().query({
        text: `INSERT INTO kataster_gen_admin (id,type,name,the_geom) 
            SELECT bm.id,'buergermeisterei',bm.name,ST_Multi(ST_UNION(grenze.the_geom,0.01)) 
            FROM "kataster_gen_admin" as grenze 
                JOIN kataster_metadata_gemeinden as g ON grenze.id=g.id 
                JOIN kataster_metadata_buergermeistereien as bm ON g.buergermeisterei=bm.id 
            WHERE grenze.type='gemeinde'
            GROUP BY bm.id`
    })
    consola.debug("Bürgermeistereigrenzen in kataster_gen_admin erzeugt")

    await database.getClient().query({
        text: `INSERT INTO kataster_gen_admin (id,type,name,the_geom) 
            SELECT k.id,'kreis',k.name,ST_Multi(ST_UNION(grenze.the_geom,0.01)) 
            FROM "kataster_gen_admin" as grenze 
                JOIN kataster_metadata_gemeinden as g ON grenze.id=g.id 
                JOIN kataster_metadata_buergermeistereien as bm ON g.buergermeisterei=bm.id 
                JOIN kataster_metadata_kreise as k ON bm.kreis=k.id 
            WHERE grenze.type='gemeinde'
            GROUP BY k.id`
    })
    consola.debug("Kreisgrenzen in kataster_gen_admin erzeugt")
}

export async function writeBezeichnungen(bezeichnungen: Bezeichnung[]):Promise<void> {
    if( bezeichnungen.length == 0 ) {
        return;
    }
    if( bezeichnungen.length > 8192 ) {
        for( let i=0; i<bezeichnungen.length; i+=8192 ) {
            await writeBezeichnungen(bezeichnungen.slice(i, i+8192));
        }
        return;
    }

    consola.debug("Schreibe", bezeichnungen.length, "Lageangaben nach kataster_gen_bezeichnungen")

    let query = "INSERT INTO kataster_gen_bezeichnungen (gemeinde,flur,name,typ,the_geom) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const b of bezeichnungen ) {
        const part = `($${idx++},$${idx++},$${idx++},$${idx++},ST_SetSRID(ST_GeomFromGeoJSON($${idx++}),${SRS}))`;
        values.push(b.gemeinde.getId(), b.flur, b.name, b.type, JSON.stringify(b.geom));
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })
}

export async function writeStrassen(strassen: Strasse[]):Promise<void> {
    if( strassen.length == 0 ) {
        return;
    }
    if( strassen.length > 8192 ) {
        for( let i=0; i<strassen.length; i+=8192 ) {
            await writeStrassen(strassen.slice(i, i+8192));
        }
        return;
    }

    consola.debug("Schreibe", strassen.length, "Straßen nach kataster_gen_strassen")
    
    let query = "INSERT INTO kataster_gen_strassen (gemeinde,flur,name,type,anmerkung,the_geom) VALUES ";
    let values = [];
    let idx = 1;
    let queryParts:string[] = []
    for( const s of strassen ) {
        const part = `($${idx++},$${idx++},$${idx++},$${idx++},$${idx++},ST_SetSRID(ST_GeomFromGeoJSON($${idx++}),${SRS}))`;
        values.push(s.gemeinde.getId(), s.flur, s.name, s.type, s.anmerkung, JSON.stringify(s.geom));
        queryParts.push(part);
    }

    await database.getClient().query({
        text: query+queryParts.join(',')+';', 
        values: values
    })
}

