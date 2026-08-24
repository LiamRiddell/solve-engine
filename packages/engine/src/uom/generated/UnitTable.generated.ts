/**
 * Unit conversion tables, ported from the `convert` npm package v7.0.2.
 *
 * DO NOT EDIT BY HAND. Regenerate with:
 *   node scripts/generate-unit-table.mjs
 *
 * Ported rather than depended on so the engine ships with no runtime
 * dependencies. See scripts/generate-unit-table.mjs for why the tables are
 * mirrored verbatim rather than hand-authored or recomputed from SI
 * definitions, and THIRD-PARTY-NOTICES.md for the upstream licence.
 *
 * Mirrored verbatim EXCEPT where upstream is arithmetically wrong. Those few
 * entries are marked "corrected" below and each one is justified in
 * UPSTREAM_UNIT_CORRECTIONS / UPSTREAM_BEST_UNIT_CORRECTIONS in the generator.
 * They are corrections of an upstream error, never a local preference.
 *
 * Upstream: https://github.com/citycide/convert (MIT, Copyright (c) Jonah Snider)
 */

/** A unit's measure kind and its ratio to that measure's base unit. */
export type UnitEntry = readonly [kind: number, ratio: number];

/**
 * Source for {@link UNIT_TABLE}, packed. Each `;`-separated record is
 * `kind|ratio|alias1,alias2,...`, so the 378 distinct `[kind, ratio]` pairs
 * spell each ratio once rather than once per alias. See {@link UNIT_TABLE}.
 *
 * Corrected vs upstream: "dm2", "dm²", "square decimeter", "square decimeters", "square decimetre", "square decimetres".
 */
const PACKED_UNIT_TABLE =
  "0|1|radian,radians,rad,rads,r;0|6.283185307179586|turn,turns;0|0.017453292519943295|degree,degrees,deg,degs,°;0|0.015707963267948967|gradian,gradians,gon,gons,grad,grads,grade,grades;0|0.0002908882086657216|arcminute,arcminutes,minutes of arc,arcmin,arcmins;0|0.00000484813681109536|arcsecond,arcseconds,seconds of arc,arcsec,arcsecs;1|1|square meter,square meters,square metre,square metres,m²,m2,centiare,centiares,ca;1|1e+30|square petameter,square petametre,square petameters,square petametres,Pm²,Pm2;1|1e+24|square terameter,square terametre,square terameters,square terametres,Tm²,Tm2;1|1000000000000000000|square gigameter,square gigametre,square gigameters,square gigametres,Gm²,Gm2;1|1000000000000|square megameter,square megametre,square megameters,square megametres,Mm²,Mm2;1|1000000|square kilometer,square kilometre,square kilometers,square kilometres,km²,km2;1|10000|square hectometer,square hectometre,square hectometers,square hectometres,hm²,hm2,hectare,hectares,ha;1|100|square decameter,square decametre,square decameters,square decametres,dam²,dam2,are,ares;1|0.01|square decimeter,square decimetre,square decimeters,square decimetres,dm²,dm2;1|0.0001|square centimeter,square centimetre,square centimeters,square centimetres,cm²,cm2;1|0.000001|square millimeter,square millimetre,square millimeters,square millimetres,mm²,mm2;1|1e-12|square micrometer,square micrometre,square micrometers,square micrometres,μm²,µm²,μm2,µm2;1|1e-18|square nanometer,square nanometre,square nanometers,square nanometres,nm²,nm2;1|1e-24|square picometer,square picometre,square picometers,square picometres,pm²,pm2;1|1e-30|square femtometer,square femtometre,square femtometers,square femtometres,fm²,fm2;1|4046.8564224|acre,acres,ac;1|10|deciare,deciares,da;1|1000|decare,decares,daa;1|0.09290304|square foot,square feet,sq ft,ft²,ft2;1|0.00064516|square inch,square inches,sq in,in²,in2;1|0.83612736|square yard,square yards,sq yd,yd²,yd2;1|2589988.110336|square mile,square miles,sq mi,mi²,mi2;1|666.6666666666666|mǔ,mu;2|1|bit,bits,b;2|1125899906842624|pebibit,pebibits,Pib;2|1099511627776|tebibit,tebibits,Tib;2|1073741824|gibibit,gibibits,Gib;2|1048576|mebibit,mebibits,Mib;2|1024|kibibit,kibibits,Kib;2|1000|Kb,kilobit,kilobits,kb;2|8000|KB,kilobyte,kilobytes,kB;2|1000000000000000|petabit,petabits,Pb;2|1000000000000|terabit,terabits,Tb;2|1000000000|gigabit,gigabits,Gb;2|1000000|megabit,megabits,Mb;2|100|hectobit,hectobits,hb;2|10|decabit,decabits,dab;2|0.1|decibit,decibits,db;2|0.01|centibit,centibits,cb;2|0.001|millibit,millibits,mb;2|0.000001|microbit,microbits,μb,µb;2|1e-9|nanobit,nanobits,nb;2|1e-12|picobit,picobits,pb;2|1e-15|femtobit,femtobits,fb;2|4|nibble,nibbles,semioctet,semioctets,halfbyte,halfbytes;2|8|byte,bytes,octect,octects,B;2|9007199254740992|pebibyte,pebibytes,PiB;2|8796093022208|tebibyte,tebibytes,TiB;2|8589934592|gibibyte,gibibytes,GiB;2|8388608|mebibyte,mebibytes,MiB;2|8192|kibibyte,kibibytes,KiB;2|8000000000000000|petabyte,petabytes,PB;2|8000000000000|terabyte,terabytes,TB;2|8000000000|gigabyte,gigabytes,GB;2|8000000|megabyte,megabytes,MB;2|800|hectobyte,hectobytes,hB;2|80|decabyte,decabytes,daB;2|0.8|decibyte,decibytes,dB;2|0.08|centibyte,centibytes,cB;2|0.008|millibyte,millibytes,mB;2|0.000008|microbyte,microbytes,μB,µB;2|8e-9|nanobyte,nanobytes,nB;2|8e-12|picobyte,picobytes,pB;2|8e-15|femtobyte,femtobytes,fB;2|16|hextet,hextets;3|1|joule,joules,J;3|1000000000000000|petajoule,petajoules,PJ;3|1000000000000|terajoule,terajoules,TJ;3|1000000000|gigajoule,gigajoules,GJ;3|1000000|megajoule,megajoules,MJ;3|1000|kilojoule,kilojoules,kJ;3|100|hectojoule,hectojoules,hJ;3|10|decajoule,decajoules,daJ;3|0.1|decijoule,decijoules,dJ;3|0.01|centijoule,centijoules,cJ;3|0.001|millijoule,millijoules,mJ;3|0.000001|microjoule,microjoules,μJ,µJ;3|1e-9|nanojoule,nanojoules,nJ;3|1e-12|picojoule,picojoules,pJ;3|1e-15|femtojoule,femtojoules,fJ;3|3600|watt-hour,W⋅h,W h,Wh;3|3600000000000000000|petawatt-hour,petawatt-hours,PW⋅h,PW h,PWh;3|3600000000000000|terawatt-hour,terawatt-hours,TW⋅h,TW h,TWh;3|3600000000000|gigawatt-hour,gigawatt-hours,GW⋅h,GW h,GWh;3|3600000000|megawatt-hour,megawatt-hours,MW⋅h,MW h,MWh;3|3600000|kilowatt-hour,kilowatt-hours,kW⋅h,kW h,kWh;3|360000|hectowatt-hour,hectowatt-hours,hW⋅h,hW h,hWh;3|36000|decawatt-hour,decawatt-hours,daW⋅h,daW h,daWh;3|360|deciwatt-hour,deciwatt-hours,dW⋅h,dW h,dWh;3|36|centiwatt-hour,centiwatt-hours,cW⋅h,cW h,cWh;3|3.6|milliwatt-hour,milliwatt-hours,mW⋅h,mW h,mWh;3|0.0036|microwatt-hour,microwatt-hours,μW⋅h,µW⋅h,μW h,µW h,μWh,µWh;3|0.0000036|nanowatt-hour,nanowatt-hours,nW⋅h,nW h,nWh;3|3.6e-9|picowatt-hour,picowatt-hours,pW⋅h,pW h,pWh;3|3.6e-12|femtowatt-hour,femtowatt-hours,fW⋅h,fW h,fWh;4|1|newton,newtons,N;4|1000000000000000|petanewton,petanewtons,PN;4|1000000000000|teranewton,teranewtons,TN;4|1000000000|giganewton,giganewtons,GN;4|1000000|meganewton,meganewtons,MN;4|1000|kilonewton,kilonewtons,kN;4|100|hectonewton,hectonewtons,hN;4|10|decanewton,decanewtons,daN;4|0.1|decinewton,decinewtons,dN;4|0.01|centinewton,centinewtons,cN;4|0.001|millinewton,millinewtons,mN;4|0.000001|micronewton,micronewtons,μN,µN;4|1e-9|nanonewton,nanonewtons,nN;4|1e-12|piconewton,piconewtons,pN;4|1e-15|femtonewton,femtonewtons,fN;4|0.00001|dyne,dynes,dyn;4|4.448222|pound of force,pound-force,lbf;4|4448.2216|kip,klb,kipf,klbf;4|0.138255|poundal,poundals,pdl;4|9.80665|kilogram-force,kilopond,kiloponds,kgf,kp;4|9806.65|tonne-force,metric ton-force,megagram-force,megapond,tf,Mp;5|1|hertz,Hz;5|1000000000000000|petahertz,PHz;5|1000000000000|terahertz,THz;5|1000000000|gigahertz,GHz;5|1000000|megahertz,MHz;5|1000|kilohertz,kHz;5|100|hectohertz,hHz;5|10|decahertz,daHz;5|0.1|decihertz,dHz;5|0.01|centihertz,cHz;5|0.001|millihertz,mHz;5|0.000001|microhertz,μHz,µHz;5|1e-9|nanohertz,nHz;5|1e-12|picohertz,pHz;5|1e-15|femtohertz,fHz;6|1|lux,lx,lumen per square meter,lm/m2,lm/m²;6|1000000000000000|petalux,Plx;6|1000000000000|teralux,Tlx;6|1000000000|gigalux,Glx;6|1000000|megalux,Mlx;6|1000|kilolux,klx;6|100|hectolux,hlx;6|10|decalux,dalx;6|0.1|decilux,dlx;6|0.01|centilux,clx;6|0.001|millilux,mlx;6|0.000001|microlux,μlx,µlx;6|1e-9|nanolux,nlx;6|1e-12|picolux,plx;6|1e-15|femtolux,flx;6|10.764|foot-candle,foot candle,fc,ft-c;6|10000|phot,ph;7|1|meter,meters,metre,metres,m;7|1000000000000000|petameter,petametre,petameters,petametres,Pm;7|1000000000000|terameter,terametre,terameters,terametres,Tm;7|1000000000|gigameter,gigametre,gigameters,gigametres,Gm;7|1000000|megameter,megametre,megameters,megametres,Mm;7|1000|kilometer,kilometre,kilometers,kilometres,km;7|100|hectometer,hectometre,hectometers,hectometres,hm;7|10|decameter,decametre,decameters,decametres,dam;7|0.1|decimeter,decimetre,decimeters,decimetres,dm;7|0.01|centimeter,centimetre,centimeters,centimetres,cm;7|0.001|millimeter,millimetre,millimeters,millimetres,mm;7|0.000001|micrometer,micrometre,micrometers,micrometres,μm,µm;7|1e-9|nanometer,nanometre,nanometers,nanometres,nm;7|1e-12|picometer,picometre,picometers,picometres,pm;7|1e-15|femtometer,femtometre,femtometers,femtometres,fm;7|0.3048|foot,feet,ft,';7|0.3048006096012192|US survey foot,US survey feet,U.S. survey foot,U.S. survey feet;7|0.0254|inch,inches,in,\";7|0.9144|yard,yards,yd;7|1609.344|mile,miles,mi;7|1852|nautical mile,nautical miles,M,NM,nmi;7|9460730472580800|light-year,light-years,ly;7|30856775814913670|parsec,parsecs,pc;7|0.0042333|pica,picas;7|0.0003528|point,points;8|1|candela per square meter,candelas per square meter,candela per square metre,candelas per square metre,cd/m2,cd/m²,nit,nits,nt;8|1000000000000000|petacandela per square meter,petacandelas per square meter,petacandela per square metre,petacandelas per square metre,Pcd/m2,Pcd/m²;8|1000000000000|teracandela per square meter,teracandelas per square meter,teracandela per square metre,teracandelas per square metre,Tcd/m2,Tcd/m²;8|1000000000|gigacandela per square meter,gigacandelas per square meter,gigacandela per square metre,gigacandelas per square metre,Gcd/m2,Gcd/m²;8|1000000|megacandela per square meter,megacandelas per square meter,megacandela per square metre,megacandelas per square metre,Mcd/m2,Mcd/m²;8|1000|kilocandela per square meter,kilocandelas per square meter,kilocandela per square metre,kilocandelas per square metre,kcd/m2,kcd/m²;8|100|hectocandela per square meter,hectocandelas per square meter,hectocandela per square metre,hectocandelas per square metre,hcd/m2,hcd/m²;8|10|decacandela per square meter,decacandelas per square meter,decacandela per square metre,decacandelas per square metre,dacd/m2,dacd/m²;8|0.1|decicandela per square meter,decicandelas per square meter,decicandela per square metre,decicandelas per square metre,dcd/m2,dcd/m²;8|0.01|centicandela per square meter,centicandelas per square meter,centicandela per square metre,centicandelas per square metre,ccd/m2,ccd/m²;8|0.001|millicandela per square meter,millicandelas per square meter,millicandela per square metre,millicandelas per square metre,mcd/m2,mcd/m²;8|0.000001|microcandela per square meter,microcandelas per square meter,microcandela per square metre,microcandelas per square metre,μcd/m2,µcd/m2,μcd/m²,µcd/m²;8|1e-9|nanocandela per square meter,nanocandelas per square meter,nanocandela per square metre,nanocandelas per square metre,ncd/m2,ncd/m²;8|1e-12|picocandela per square meter,picocandelas per square meter,picocandela per square metre,picocandelas per square metre,pcd/m2,pcd/m²;8|1e-15|femtocandela per square meter,femtocandelas per square meter,femtocandela per square metre,femtocandelas per square metre,fcd/m2,fcd/m²;9|1|candela,cd,candlepower,cp,CP;9|1000000000000000|petacandela,Pcd;9|1000000000000|teracandela,Tcd;9|1000000000|gigacandela,Gcd;9|1000000|megacandela,Mcd;9|1000|kilocandela,kcd;9|100|hectocandela,hcd;9|10|decacandela,dacd;9|0.1|decicandela,dcd;9|0.01|centicandela,ccd;9|0.001|millicandela,mcd;9|0.000001|microcandela,μcd,µcd;9|1e-9|nanocandela,ncd;9|1e-12|picocandela,pcd;9|1e-15|femtocandela,fcd;9|0.92|hefnerkerze,HK;10|1|gram,grams,g;10|1000000000000000|petagram,petagrams,Pg,gigatonne,gigatonnes,Gt;10|1000000000000|teragram,teragrams,Tg,megatonne,megatonnes,Mt;10|1000000000|gigagram,gigagrams,Gg,kilotonne,kilotonnes,kt;10|1000000|megagram,megagrams,Mg,tonne,tonnes,metric ton,metric tons,t;10|1000|kilogram,kilograms,kg;10|100|hectogram,hectograms,hg;10|10|decagram,decagrams,dag;10|0.1|decigram,decigrams,dg;10|0.01|centigram,centigrams,cg;10|0.001|milligram,milligrams,mg;10|0.000001|microgram,micrograms,μg,µg,mcg;10|1e-9|nanogram,nanograms,ng;10|1e-12|picogram,picograms,pg;10|1e-15|femtogram,femtograms,fg;10|453.59237|pound,pounds,lb,lbs;10|0.06479891|grain,grains,gr;10|6350.29318|stone,stones,st;10|28.349523125|ounce,ounces,oz;10|45360|short hundredweight,cental;10|50800|long hundredweight,imperial hundredweight,cwt;10|907184.74|short ton,short tons,US ton,US tons;10|1016046.9088|long ton,long tons,imperial ton,imperial tons,displacement ton,displacement tons;10|31.1034768|troy ounce,oz t,toz;11|1|watt,watts,W;11|1000000000000000|petawatt,petawatts,PW;11|1000000000000|terawatt,terawatts,TW;11|1000000000|gigawatt,gigawatts,GW;11|1000000|megawatt,megawatts,MW;11|1000|kilowatt,kilowatts,kW;11|100|hectowatt,hectowatts,hW;11|10|decawatt,decawatts,daW;11|0.1|deciwatt,deciwatts,dW;11|0.01|centiwatt,centiwatts,cW;11|0.001|milliwatt,milliwatts,mW;11|0.000001|microwatt,microwatts,μW,µW;11|1e-9|nanowatt,nanowatts,nW;11|1e-12|picowatt,picowatts,pW;11|1e-15|femtowatt,femtowatts,fW;11|745.699872|horsepower,mechanical horsepower,hp;12|1|pascal,pascals,Pa;12|1000000000000000|petapascal,petapascals,PPa;12|1000000000000|terapascal,terapascals,TPa;12|1000000000|gigapascal,gigapascals,GPa;12|1000000|megapascal,megapascals,MPa,decabar,decabars,dabar;12|1000|kilopascal,kilopascals,kPa,centibar,centibars,cbar;12|100|hectopascal,hectopascals,hPa,millibar,millibars,mbar;12|10|decapascal,decapascals,daPa;12|0.1|decipascal,decipascals,dPa,microbar,microbars,μbar,µbar;12|0.01|centipascal,centipascals,cPa;12|0.001|millipascal,millipascals,mPa;12|0.000001|micropascal,micropascals,μPa,µPa;12|1e-9|nanopascal,nanopascals,nPa;12|1e-12|picopascal,picopascals,pPa;12|1e-15|femtopascal,femtopascals,fPa;12|100000|bar,bars;12|100000000000000000000|petabar,petabars,Pbar;12|100000000000000000|terabar,terabars,Tbar;12|100000000000000|gigabar,gigabars,Gbar;12|100000000000|megabar,megabars,Mbar;12|100000000|kilobar,kilobars,kbar;12|10000000|hectobar,hectobars,hbar;12|10000|decibar,decibars,dbar;12|0.0001|nanobar,nanobars,nbar;12|1e-7|picobar,picobars,pbar;12|1e-10|femtobar,femtobars,fbar;12|133.32236842105263|torr,torrs,Torr;12|0.13332236842105263|millitorr,mTorr;12|101325|atmosphere,atmospheres,atm;12|6894.757|pound per square inch,pounds per square inch,psi,lbf/in2,lbf/in²;12|249.0889|inch of water,inches of water,inAq,Aq;12|3386.389|inch of mercury,inches of mercury,inHg,Hg;13|1|kelvin,kelvins,K,celsius,C,°C;13|1000000000000000|petakelvin,petakelvins,PK;13|1000000000000|terakelvin,terakelvins,TK;13|1000000000|gigakelvin,gigakelvins,GK;13|1000000|megakelvin,megakelvins,MK;13|1000|kilokelvin,kilokelvins,kK;13|100|hectokelvin,hectokelvins,hK;13|10|decakelvin,decakelvins,daK;13|0.1|decikelvin,decikelvins,dK;13|0.01|centikelvin,centikelvins,cK;13|0.001|millikelvin,millikelvins,mK;13|0.000001|microkelvin,microkelvins,μK,µK;13|1e-9|nanokelvin,nanokelvins,nK;13|1e-12|picokelvin,picokelvins,pK;13|1e-15|femtokelvin,femtokelvins,fK;13|0.5555555555555556|fahrenheit,F,°F,rankine,R;14|1|second,seconds,s;14|1000000000000000|petasecond,petaseconds,Ps;14|1000000000000|terasecond,teraseconds,Ts;14|1000000000|gigasecond,gigaseconds,Gs;14|1000000|megasecond,megaseconds,Ms;14|1000|kilosecond,kiloseconds,ks;14|100|hectosecond,hectoseconds,hs;14|10|decasecond,decaseconds,das;14|0.1|decisecond,deciseconds,ds;14|0.01|centisecond,centiseconds,cs;14|0.001|millisecond,milliseconds,ms;14|0.000001|microsecond,microseconds,μs,µs;14|1e-9|nanosecond,nanoseconds,ns;14|1e-12|picosecond,picoseconds,ps;14|1e-15|femtosecond,femtoseconds,fs;14|60|minute,minutes,min;14|3600|hour,hours,h;14|86.4|milliday,millidays,md;14|86400|day,days,d;14|604800|week,weeks,wk;14|1209600|fortnight,fortnights,fn;14|2592000|month,months,mo;14|31536000|year,years,a,y,yr;14|315360000|decade,decades,dec;14|3153600000|century,centuries;14|31536000000|millennium,millennia;14|90|moment,moments;14|1e-8|shake,shakes;14|0.001024|time unit,TU;14|1e-13|svedberg,svedbergs,S;15|1|cubic meter,cubic meters,cubic metre,cubic metres,stere,steres,m³,m3,kiloliter,kiloliters,kilolitre,kilolitres,kl,kL;15|1e+45|cubic petameter,cubic petameters,Pm3,Pm³;15|1e+36|cubic terameter,cubic terameters,Tm3,Tm³;15|1e+27|cubic gigameter,cubic gigameters,Gm3,Gm³;15|1000000000000000000|cubic megameter,cubic megameters,Mm3,Mm³;15|1000000000|cubic kilometer,cubic kilometers,km3,km³,teraliter,teraliters,teralitre,teralitres,Tl,TL;15|1000000|cubic hectometer,cubic hectometers,hm3,hm³,gigaliter,gigaliters,gigalitre,gigalitres,Gl,GL;15|1000|cubic decameter,cubic decameters,dam3,dam³,megaliter,megaliters,megalitre,megalitres,Ml,ML;15|0.001|cubic decimeter,cubic decimeters,dm3,dm³,liter,liters,litre,litres,l,L;15|0.000001|cubic centimeter,cubic centimeters,cm3,cm³,milliliter,milliliters,millilitre,millilitres,ml,mL;15|1e-9|cubic millimeter,cubic millimeters,mm3,mm³,microliter,microliters,microlitre,microlitres,μl,µl,μL,µL;15|1e-18|cubic micrometer,cubic micrometers,μm3,µm3,μm³,µm³,femtoliter,femtoliters,femtolitre,femtolitres,fl,fL;15|1e-27|cubic nanometer,cubic nanometers,nm3,nm³;15|1e-36|cubic picometer,cubic picometers,pm3,pm³;15|1e-45|cubic femtometer,cubic femtometers,fm3,fm³;15|1000000000000|petaliter,petaliters,petalitre,petalitres,Pl,PL;15|0.1|hectoliter,hectoliters,hectolitre,hectolitres,hl,hL;15|0.01|decaliter,decaliters,decalitre,decalitres,dal,daL;15|0.0001|deciliter,deciliters,decilitre,decilitres,dl,dL;15|0.00001|centiliter,centiliters,centilitre,centilitres,cl,cL;15|1e-12|nanoliter,nanoliters,nanolitre,nanolitres,nl,nL;15|1e-15|picoliter,picoliters,picolitre,picolitres,pl,pL;15|4168181825.4405794|cubic mile,cubic miles,cu mi,mi3,mi³;15|1233.48183754752|acre-foot,acre-feet,ac⋅ft,ac ft;15|0.764554857984|cubic yard,cubic yards,cu yd,yd3,yd³;15|0.028316846592|cubic foot,cubic feet,cu ft,ft3,ft³;15|0.002359737|board foot,board feet;15|0.000016387064|cubic inch,cubic inches,cu in,in3,in³;15|1.133|measurement ton,measurement tons,MTON;15|0.16365924|imperial barrel,imperial barrels,imp bbl;15|0.03636872|imperial bushel,imperial bushels,imp bsh,imp bu;15|0.00909218|imperial peck,imperial pecks,pk,imp pk;15|0.00454609|imperial gallon,imperial gallons,imp gal;15|0.0011365225|imperial quart,imperial quarts,imp qt;15|0.00056826125|imperial pint,imperial pints,imp pt;15|0.0000284130625|imperial fluid ounce,imperial fluid ounces,imp fl oz;15|0.00000492892159375|teaspoon,teaspoons,US teaspoon,US teaspoons,tsp;15|0.00001478676478125|tablespoon,tablespoons,US tablespoon,US tablespoons,tbsp;15|0.0000295735295625|US fluid ounce,US fluid ounces,fl oz,fl. oz.,oz. fl.;15|0.0002365882365|cup,cups,c;15|0.00024|US legal cup,US legal cups,US lc;15|0.000473176473|pint,pints,US liquid pint,US liquid pints,pt,p;15|0.000946352946|quart,quarts,US liquid quart,US liquid quarts,qt;15|0.003785411784|gallon,gallons,US liquid gallon,US liquid gallons,gal;15|0.03523907016688|US bushel,US bushels,US bsh,US bu;15|0.00880976754172|US peck,US pk;15|0.00440488377086|US dry gallon,US dry gal;15|0.1156|US dry barrel,US dry barrels,US dry bbl;15|0.001101220942715|US dry quart,US dry qt;15|0.0005506104713575|US dry pint,US dry pt";

/**
 * Decodes {@link PACKED_UNIT_TABLE} into the {@link UNIT_TABLE} record. The
 * aliases in one record share a single `[kind, ratio]` tuple, safe since the
 * table is read-only by type.
 */
function unpackUnitTable(packed: string): Record<string, UnitEntry> {
  const table: Record<string, UnitEntry> = {};
  for (const record of packed.split(";")) {
    const firstBar = record.indexOf("|");
    const secondBar = record.indexOf("|", firstBar + 1);
    const kind = Number(record.slice(0, firstBar));
    const ratio = Number(record.slice(firstBar + 1, secondBar));
    const entry: UnitEntry = [kind, ratio];
    for (const alias of record.slice(secondBar + 1).split(",")) {
      table[alias] = entry;
    }
  }
  return table;
}

/**
 * Every unit spelling the engine can resolve, to `[measureKind, ratioToBase]`.
 *
 * Keys are case-sensitive and are never normalized or aliased: `C` is Celsius
 * and `c` is a cup, `MB` is megabytes and `mb` is millibits. Multi-word
 * spellings are present here and resolve through the conversion API even though
 * the lexer cannot tokenize them.
 *
 * Stored packed (see {@link PACKED_UNIT_TABLE}) and decoded once at load: 1456
 * spellings share 378 distinct pairs, so each ratio parses once per pair rather
 * than once per alias. The generator asserts the packed form decodes to exactly
 * the source table.
 */
export const UNIT_TABLE: Readonly<Record<string, UnitEntry>> = unpackUnitTable(PACKED_UNIT_TABLE);

/**
 * Additive offsets applied around the ratio, for measures whose scales do not
 * share an origin. Temperature only.
 */
export const UNIT_DIFFERENCES: Readonly<Record<string, number>> = {
  "fahrenheit": 459.67,
  "F": 459.67,
  "°F": 459.67,
  "celsius": 273.15,
  "C": 273.15,
  "°C": 273.15,
};

/**
 * Ordered `[symbol, threshold]` pairs per measure kind, used to pick the most
 * readable unit for a magnitude. Thresholds are expressed in the list's FIRST
 * unit, which is therefore also its smallest, and the last entry whose
 * threshold the absolute value reaches wins.
 *
 * The two properties are load-bearing together: `convertToBestMetric` converts
 * the magnitude into the first unit and then walks forwards, breaking at the
 * first threshold it does not reach. A list that does not ascend runs off the
 * end of the sensible units rather than merely picking a poor one, and moving a
 * different unit to the front silently changes what every threshold means.
 *
 * Metric only. The imperial lists exist upstream but nothing here has ever
 * requested them, so they are not ported.
 */
export const BEST_UNITS_METRIC: Readonly<
  Record<number, readonly (readonly [symbol: string, threshold: number])[]>
> = {
  0: [["deg", 1]], // angle
  1: [["mm2", 1], ["cm2", 100], ["m2", 1000000], ["km2", 1000000000000]], // area
  2: [["bits", 1], ["B", 8], ["KB", 8000], ["MB", 8000000], ["GB", 8000000000], ["TB", 8000000000000], ["PB", 8000000000000000]], // data
  3: [["J", 1], ["Wh", 3600], ["kWh", 3600000], ["MWh", 3600000000], ["GWh", 3600000000000]], // energy
  4: [["N", 1]], // force
  5: [["Hz", 1], ["kHz", 1000], ["MHz", 1000000], ["GHz", 1000000000], ["THz", 1000000000000], ["PHz", 1000000000000000]], // frequency
  6: [["lux", 1], ["klx", 1000]], // illuminance, corrected
  7: [["mm", 1], ["cm", 10], ["m", 1000], ["km", 1000000]], // length
  8: [["cd/m²", 1]], // luminance
  9: [["cd", 1]], // luminousIntensity
  10: [["mg", 1], ["g", 1000], ["kg", 1000000]], // mass
  11: [["W", 1], ["kW", 1000], ["MW", 1000000], ["GW", 1000000000], ["TW", 1000000000000], ["PW", 1000000000000000]], // power
  12: [["Pa", 1]], // pressure
  13: [["C", 1]], // temperature
  14: [["fs", 1], ["ps", 1000], ["ns", 1000000], ["µs", 1000000000], ["ms", 1000000000000], ["s", 1000000000000000], ["min", 60000000000000000], ["h", 3600000000000000000], ["d", 86400000000000000000], ["y", 3.1536e+22]], // time
  15: [["mL", 1], ["L", 1000]], // volume
};

/**
 * The symbols offered for a measure by `<value> <unit> to ?`.
 *
 * A separate, curated vocabulary rather than the keys of UNIT_TABLE filtered by
 * kind: upstream publishes a shorter symbols-only list per unit, and the two
 * genuinely differ. Volume's symbols include `c`, `US lc` and `pt` but not
 * `cup`/`cups`; Time's include `wk` and `mo` but not `week`/`month`.
 * Deriving this from UNIT_TABLE would roughly quadruple every list.
 */
export const MEASURE_SYMBOLS: Readonly<Record<number, readonly string[]>> = {
  0: ["rad", "rads", "r", "deg", "degs", "°", "gon", "gons", "grad", "grads", "grade", "grades", "arcmin", "arcmins", "arcsec", "arcsecs"], // angle
  1: ["m²", "m2", "Pm²", "Pm2", "Tm²", "Tm2", "Gm²", "Gm2", "Mm²", "Mm2", "km²", "km2", "hm²", "hm2", "dam²", "dam2", "dm²", "dm2", "cm²", "cm2", "mm²", "mm2", "μm²", "µm²", "μm2", "µm2", "nm²", "nm2", "pm²", "pm2", "fm²", "fm2", "ac", "ca", "da", "daa", "ha", "sq ft", "ft²", "ft2", "sq in", "in²", "in2", "sq yd", "yd²", "yd2", "sq mi", "mi²", "mi2"], // area
  2: ["b", "Pib", "Tib", "Gib", "Mib", "Kib", "Kb", "KB", "Pb", "Tb", "Gb", "Mb", "kb", "hb", "dab", "db", "cb", "mb", "μb", "µb", "nb", "pb", "fb", "B", "PiB", "TiB", "GiB", "MiB", "KiB", "PB", "TB", "GB", "MB", "kB", "hB", "daB", "dB", "cB", "mB", "μB", "µB", "nB", "pB", "fB"], // data
  3: ["J", "PJ", "TJ", "GJ", "MJ", "kJ", "hJ", "daJ", "dJ", "cJ", "mJ", "μJ", "µJ", "nJ", "pJ", "fJ", "W⋅h", "W h", "Wh", "PW⋅h", "PW h", "PWh", "TW⋅h", "TW h", "TWh", "GW⋅h", "GW h", "GWh", "MW⋅h", "MW h", "MWh", "kW⋅h", "kW h", "kWh", "hW⋅h", "hW h", "hWh", "daW⋅h", "daW h", "daWh", "dW⋅h", "dW h", "dWh", "cW⋅h", "cW h", "cWh", "mW⋅h", "mW h", "mWh", "μW⋅h", "µW⋅h", "μW h", "µW h", "μWh", "µWh", "nW⋅h", "nW h", "nWh", "pW⋅h", "pW h", "pWh", "fW⋅h", "fW h", "fWh"], // energy
  4: ["N", "PN", "TN", "GN", "MN", "kN", "hN", "daN", "dN", "cN", "mN", "μN", "µN", "nN", "pN", "fN", "dyn", "lbf", "klb", "kipf", "klbf", "pdl", "kgf", "kp", "tf", "Mp"], // force
  5: ["Hz", "PHz", "THz", "GHz", "MHz", "kHz", "hHz", "daHz", "dHz", "cHz", "mHz", "μHz", "µHz", "nHz", "pHz", "fHz"], // frequency
  6: ["lx", "Plx", "Tlx", "Glx", "Mlx", "klx", "hlx", "dalx", "dlx", "clx", "mlx", "μlx", "µlx", "nlx", "plx", "flx", "lm/m2", "lm/m²", "fc", "ft-c", "ph"], // illuminance
  7: ["m", "Pm", "Tm", "Gm", "Mm", "km", "hm", "dam", "dm", "cm", "mm", "μm", "µm", "nm", "pm", "fm", "ft", "'", "in", "\"", "yd", "mi", "M", "NM", "nmi", "ly", "pc"], // length
  8: ["cd/m2", "cd/m²", "Pcd/m2", "Pcd/m²", "Tcd/m2", "Tcd/m²", "Gcd/m2", "Gcd/m²", "Mcd/m2", "Mcd/m²", "kcd/m2", "kcd/m²", "hcd/m2", "hcd/m²", "dacd/m2", "dacd/m²", "dcd/m2", "dcd/m²", "ccd/m2", "ccd/m²", "mcd/m2", "mcd/m²", "μcd/m2", "µcd/m2", "μcd/m²", "µcd/m²", "ncd/m2", "ncd/m²", "pcd/m2", "pcd/m²", "fcd/m2", "fcd/m²", "nt"], // luminance
  9: ["cd", "Pcd", "Tcd", "Gcd", "Mcd", "kcd", "hcd", "dacd", "dcd", "ccd", "mcd", "μcd", "µcd", "ncd", "pcd", "fcd", "cp", "CP", "HK"], // luminousIntensity
  10: ["g", "Pg", "Tg", "Gg", "Mg", "kg", "hg", "dag", "dg", "cg", "mg", "μg", "µg", "ng", "pg", "fg", "mcg", "t", "kt", "Mt", "Gt", "lb", "lbs", "gr", "st", "oz", "cwt", "oz t", "toz"], // mass
  11: ["W", "PW", "TW", "GW", "MW", "kW", "hW", "daW", "dW", "cW", "mW", "μW", "µW", "nW", "pW", "fW", "hp"], // power
  12: ["Pa", "PPa", "TPa", "GPa", "MPa", "kPa", "hPa", "daPa", "dPa", "cPa", "mPa", "μPa", "µPa", "nPa", "pPa", "fPa", "bar", "Pbar", "Tbar", "Gbar", "Mbar", "kbar", "hbar", "dabar", "dbar", "cbar", "mbar", "μbar", "µbar", "nbar", "pbar", "fbar", "Torr", "mTorr", "atm", "psi", "lbf/in2", "lbf/in²", "inAq", "Aq", "inHg", "Hg"], // pressure
  13: ["K", "PK", "TK", "GK", "MK", "kK", "hK", "daK", "dK", "cK", "mK", "μK", "µK", "nK", "pK", "fK", "F", "°F", "C", "°C", "R"], // temperature
  14: ["s", "Ps", "Ts", "Gs", "Ms", "ks", "hs", "das", "ds", "cs", "ms", "μs", "µs", "ns", "ps", "fs", "min", "h", "md", "d", "wk", "fn", "mo", "a", "y", "yr", "dec", "TU", "S"], // time
  15: ["m³", "m3", "Pm3", "Pm³", "Tm3", "Tm³", "Gm3", "Gm³", "Mm3", "Mm³", "km3", "km³", "hm3", "hm³", "dam3", "dam³", "dm3", "dm³", "cm3", "cm³", "mm3", "mm³", "μm3", "µm3", "μm³", "µm³", "nm3", "nm³", "pm3", "pm³", "fm3", "fm³", "l", "L", "Pl", "PL", "Tl", "TL", "Gl", "GL", "Ml", "ML", "kl", "kL", "hl", "hL", "dal", "daL", "dl", "dL", "cl", "cL", "ml", "mL", "μl", "µl", "μL", "µL", "nl", "nL", "pl", "pL", "fl", "fL", "cu mi", "mi3", "mi³", "ac⋅ft", "ac ft", "cu yd", "yd3", "yd³", "cu ft", "ft3", "ft³", "cu in", "in3", "in³", "MTON", "imp bbl", "imp bsh", "imp bu", "pk", "imp pk", "imp gal", "imp qt", "imp pt", "imp fl oz", "tsp", "tbsp", "fl oz", "fl. oz.", "oz. fl.", "c", "US lc", "pt", "p", "qt", "gal", "US bsh", "US bu", "US pk", "US dry gal", "US dry bbl", "US dry qt", "US dry pt"], // volume
};

/**
 * Measure kind id to the name `getMeasure()` reports. Two units are
 * convertible only when these strings match, so a typo here silently breaks
 * conversion for one whole measure.
 */
export const MEASURE_KIND_NAMES: Readonly<Record<number, string>> = {
  0: "angle",
  1: "area",
  2: "data",
  3: "energy",
  4: "force",
  5: "frequency",
  6: "illuminance",
  7: "length",
  8: "luminance",
  9: "luminousIntensity",
  10: "mass",
  11: "power",
  12: "pressure",
  13: "temperature",
  14: "time",
  15: "volume",
};
