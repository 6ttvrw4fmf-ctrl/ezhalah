// Official picker artwork; location copy derives from the measured listing coverage.
import logoLayout from './platformPickerLogoLayout.json';
import coverageSnapshot from './platformPickerCoverage.json';
import { platformCoverageSentence, platformCoverageGroup, type PickerCoverage } from '../lib/platformCoverageSentence';
export type PlatformPickerProfile = { logo: number; ar: string; en: string; group: { ar: {key: string; order: number; label: string}; en: {key: string; order: number; label: string} }; layout: { width: number; height: number; left: number; top: number; monochrome: boolean } };
const LOGOS: Record<string, number> = {
  "Aqar": require("../../assets/images/platform-logos/sa-aqar-fm.png"),
  "Wasalt": require("../../assets/images/platform-logos/wasalt-sa.png"),
  "Aldarim": require("../../assets/images/platform-logos/aldarim-sa.png"),
  "Aqargate": require("../../assets/images/platform-logos/aqargate-com.png"),
  "Alhoshan": require("../../assets/images/platform-logos/alhoshan-sa.png"),
  "Hajer": require("../../assets/images/platform-logos/hajerhouses-com.png"),
  "Sanadak": require("../../assets/images/platform-logos/sanadak-sa.png"),
  "Eastabha": require("../../assets/images/platform-logos/eastabha-sa.png"),
  "Aqarcity": require("../../assets/images/platform-logos/aqarcity-net.png"),
  "Raghdan": require("../../assets/images/platform-logos/raghdan-sa.png"),
  "Eaqartabuk": require("../../assets/images/platform-logos/eaqartabuk-com.png"),
  "Satel": require("../../assets/images/platform-logos/satel-sa.png"),
  "Sadin": require("../../assets/images/sadin.png"),
  "Mustqr": require("../../assets/images/platform-logos/mustqr-sa.png"),
  "Ramzalqasim": require("../../assets/images/platform-logos/ramzalqasim-com.png"),
  "Fursaghyr": require("../../assets/images/platform-logos/fursaghyr-com.png"),
  "Jazwtn": require("../../assets/images/platform-logos/jazwtn-sa.png"),
  "Mizlaj": require("../../assets/images/platform-logos/mizlaj-com-sa.png"),
  "Aqaratikom": require("../../assets/images/platform-logos/nawait-sa.png"),
  "Al Khaas": require("../../assets/images/platform-logos/alkhaas-net.png"),
  "Abeea": require("../../assets/images/platform-logos/abeea-com-sa.png"),
  "Jurash": require("../../assets/images/platform-logos/jurash-sa.png"),
  "Gathern": require("../../assets/images/platform-logos/gathern-co.png"),
  "Deal App": require("../../assets/images/platform-logos/dealapp-sa.png"),
  "24 Souq": require("../../assets/images/platform-logos/24-com-sa.png"),
  "Era Pulse": require("../../assets/images/platform-logos/erapulse-sa.png"),
  "Al Nowaisiry": require("../../assets/images/nowaisiry.png"),
  "1 October": require("../../assets/images/platform-logos/1october-com-sa.png"),
  "Muktamel": require("../../assets/images/platform-logos/muktamel-com.png"),
  "Arkaan": require("../../assets/images/platform-logos/arkaanalaqar-com.png"),
  "Abralosol": require("../../assets/images/platform-logos/abralosol-com.png"),
  "THERC": require("../../assets/images/platform-logos/therc-sa.png"),
  "Rawasi Dark": require("../../assets/images/platform-logos/rawasi-dark-com.png"),
  "Aouj": require("../../assets/images/platform-logos/aoujestates-com.png"),
  "Bahadhabab": require("../../assets/images/platform-logos/bahadhabab-res-com.png"),
  "Alobid": require("../../assets/images/platform-logos/alobidoffice-com.png"),
  "Abwbna": require("../../assets/images/platform-logos/abwbna-com.png"),
  "Remal": require("../../assets/images/platform-logos/remalre-com.png"),
  "Amaall": require("../../assets/images/platform-logos/amaall-com.png"),
  "AqarAlSaudia": require("../../assets/images/aqaralsaudia.png"),
  "Amlakalahsa": require("../../assets/images/platform-logos/amlakalahsa-com.png"),
  "Alta": require("../../assets/images/platform-logos/alta-com-sa.png"),
  "Shmou Al Shmal": require("../../assets/images/platform-logos/shmoua-alshmal-com.png"),
  "Awal": require("../../assets/images/platform-logos/awaalun-com.png"),
  "Azdad": require("../../assets/images/platform-logos/azdadalaqaria-com.png"),
  "Suwar": require("../../assets/images/platform-logos/suwar-sa.png"),
  "Rakez": require("../../assets/images/platform-logos/rakez-sa.png"),
  "Akariyoun": require("../../assets/images/platform-logos/akariyoun-sa.png"),
  "KSA Aqar": require("../../assets/images/platform-logos/ksaaqar-com.png"),
  "Sadiq Eltajer": require("../../assets/images/platform-logos/sadiq-eltajer-sa.png"),
  "Toor": require("../../assets/images/toor.png"),
  "Gudai": require("../../assets/images/platform-logos/gudai-inblaj-net.png"),
  "Safera": require("../../assets/images/platform-logos/safera-inblaj-net.png"),
  "Al Humaidan": require("../../assets/images/alhumaidan.png"),
  "Aqar Najran": require("../../assets/images/platform-logos/aqarnajran-com.png"),
  "Maqam Al Wisam": require("../../assets/images/platform-logos/fahadalshahri-com.png"),
  "CompoundIn": require("../../assets/images/platform-logos/compoundin-com.png"),
  "Waslna": require("../../assets/images/platform-logos/wslnaa-com.png"),
  "Al Sidra": require("../../assets/images/platform-logos/alsidra.png"),
  "Moftah": require("../../assets/images/platform-logos/moftah-aleaqar-com.png"),
  "مسار المستقبل": require("../../assets/images/platform-logos/masaraqarat-com.png"),
  "منصات": require("../../assets/images/platform-logos/gomenassat-com.png"),
  "Sakan Saudi": require("../../assets/images/platform-logos/sa-sakan-co.png"),
  "مكتب بوصبيح": require("../../assets/images/platform-logos/bossbihoffice-com-sa.png"),
  "Al Shawaf": require("../../assets/images/platform-logos/alshawaf-com-sa.png"),
  "Ibrahim Alqarawi": require("../../assets/images/platform-logos/ialqarawi-com.png"),
  "Al Jassim": require("../../assets/images/platform-logos/aljassimaqar-com.png"),
  "Almotmkenah": require("../../assets/images/platform-logos/almotmkenah-com.png"),
  "نفوذ": require("../../assets/images/platform-logos/nufouth-com.png"),
  "دويليو": require("../../assets/images/platform-logos/dwelleo-sa.png"),
  "مكتب أقاليم هجر للخدمات العقارية": require("../../assets/images/platform-logos/aqalemhajer-com.png"),
  "سكني": require("../../assets/images/sakani.png"),
  "الشاطري للتطوير العقاري": require("../../assets/images/platform-logos/shatri.png"),
  "القاسم العقارية": require("../../assets/images/platform-logos/alqasem.png"),
  "فكر الإعمار": require("../../assets/images/platform-logos/fkralemar.png"),
  "ودود العقارية": require("../../assets/images/platform-logos/wadod.png"),
  "آل متعب العقارية": require("../../assets/images/platform-logos/almuteb.png"),
  "البراك للعقارات": require("../../assets/images/platform-logos/aalbarrak.png"),
  "الرفاعي للعقار": require("../../assets/images/platform-logos/alrifai.png"),
  "سداسيات العقارية": require("../../assets/images/platform-logos/sodasyat.png"),
  "حصاد الاقتصادية للعقارات": require("../../assets/images/platform-logos/hasaad.png"),
  "عقار الرياض": require("../../assets/images/platform-logos/aqaralriyadh.png"),
  "فقط نقطة العقارية": require("../../assets/images/platform-logos/just-sa.png"),
  "سنام العقارية": require("../../assets/images/platform-logos/snam.png"),
  "جواهر للوساطة والتسويق العقاري": require("../../assets/images/platform-logos/jawher.png"),
  "مقر المعتمد": require("../../assets/images/platform-logos/m3tmd.png"),
  "سنان العقارية": require("../../assets/images/platform-logos/senan.png"),
  "الصفقة الذهبية العقارية": require("../../assets/images/platform-logos/goldendeal-sa.png"),
  "1000 العقارية": require("../../assets/images/platform-logos/1000-com-sa.png"),
  "يمين العقارية": require("../../assets/images/platform-logos/yameen.png"),
  "إبريزة العقارية": require("../../assets/images/platform-logos/ebriza-com-sa.png"),
  "علم الريادة الإدارية": require("../../assets/images/eilmalriyada.png"),
  "دار يوسف العقارية": require("../../assets/images/platform-logos/daryusuf-com.png"),
  "البداح للعقارات": require("../../assets/images/platform-logos/albdah.png"),
  "الإيضاح": require("../../assets/images/platform-logos/eydah.png"),
  "تمايز العقارية": require("../../assets/images/platform-logos/tamyaz.png"),
  "حازم": require("../../assets/images/platform-logos/hazim.png"),
  "فلل": require("../../assets/images/platform-logos/villassa.png"),
  "مار العقارية": require("../../assets/images/platform-logos/marksa.png"),
  "RightCompound": require("../../assets/images/platform-logos/rightcompound-com.png"),
  "LivingCompound": require("../../assets/images/platform-logos/livingcompound.png"),
  "Azure": require("../../assets/images/platform-logos/azure.png"),
  "Expat Trusted Housing": require("../../assets/images/platform-logos/expattrusted.png"),
  "Flow": require("../../assets/images/platform-logos/flow.png"),
  "أبعاد": require("../../assets/images/platform-logos/app-abaadapp-sa.png"),
  "آل سعيدان": require("../../assets/images/platform-logos/alsaedan-com.png"),
  "إيجو عقار": require("../../assets/images/platform-logos/ego.png"),
  "أحمد المحيسني العقارية": require("../../assets/images/platform-logos/aqaralmuhaysini-com.png"),
  "نفوذ للاستثمار العقاري": require("../../assets/images/platform-logos/nofodh-sa.png"),
  "راز العقارية": require("../../assets/images/platform-logos/razre-sa.png"),
  "ري إنفست": require("../../assets/images/platform-logos/reinvest-sa.png"),
  "صفا للاستثمار": require("../../assets/images/platform-logos/safa.png"),
  "صكوك العقارية": require("../../assets/images/platform-logos/sokok-sa.png"),
  "سكنة": require("../../assets/images/platform-logos/sukna-app.png"),
  "طوبة العقارية": require("../../assets/images/platform-logos/tuba-com-sa.png"),
  "آي باكس": require("../../assets/images/platform-logos/ibaax-sa.png"),
  "RE/MAX": require("../../assets/images/platform-logos/remaxsa.png"),
  "قمرا للتطوير العقاري": require("../../assets/images/platform-logos/qmra.png"),
  "العجلان للتسويق العقاري": require("../../assets/images/platform-logos/alajlan.png"),
  "وحدات": require("../../assets/images/platform-logos/wahadat-sa.png"),
  "شركة المربعات العقارية": require("../../assets/images/platform-logos/squares.png"),
  "رواف": require("../../assets/images/platform-logos/rawaf.png"),
  "المسوق الافتراضي": require("../../assets/images/platform-logos/vm-ksa-com.png"),
  "مكسب العقارية": require("../../assets/images/platform-logos/macsaib.png"),
  "MAQRAT": require("../../assets/images/platform-logos/maqrat-com.png"),
  "عرش العقارية": require("../../assets/images/platform-logos/arsh.png"),
  "سوبر أوفيس": require("../../assets/images/platform-logos/superoffice.png"),
  "شموع العقار": require("../../assets/images/platform-logos/shomoalaqar-com-sa.png"),
  "منصة مكتب": require("../../assets/images/platform-logos/maktab.png"),
  "سرداب": require("../../assets/images/platform-logos/marketplace-sirdab-co.png"),
  "عشاب العقارية": require("../../assets/images/platform-logos/ashab-sa.png"),
  "منافع العقارية": require("../../assets/images/platform-logos/manafe-com-sa.png"),
  "وجف العقارية": require("../../assets/images/platform-logos/wajaf.png"),
  "البكيري العقارية": require("../../assets/images/platform-logos/albukaeri.png"),
  "ريادة العقارية": require("../../assets/images/platform-logos/ryadah.png"),
  "مجموعة صالح القرشي العقارية": require("../../assets/images/platform-logos/sqcc.png"),
  "دارا للتطوير العقاري": require("../../assets/images/platform-logos/daraa.png"),
  "مكتب طوية للعقار": require("../../assets/images/platform-logos/tawia.png"),
  "مانزو": require("../../assets/images/platform-logos/manzo.png"),
  "الطابق الثامن": require("../../assets/images/platform-logos/eightfloor.png"),
  "حلول": require("../../assets/images/platform-logos/holoul.png"),
  "السوق المفتوح": require("../../assets/images/platform-logos/sa-opensooq-com.png"),
  "معرض نافذة": require("../../assets/images/platform-logos/nafithh.png"),
  "مباشر": require("../../assets/images/platform-logos/mobasher.png"),
  "مؤاجرة": require("../../assets/images/platform-logos/muajarh.png"),
  "دلّالي": require("../../assets/images/platform-logos/dallali.png"),
  "شركة مقام للتطوير العقاري": require("../../assets/images/platform-logos/maqam.png"),
  "تطبيق أرض": require("../../assets/images/platform-logos/earthapp.png"),
  "نوافذ الوطن": require("../../assets/images/platform-logos/nawafeth.png"),
};
// Deal uses the same original yellow brand asset as listing cards (owner, 2026-10-08).
LOGOS["Deal App"] = require("../../assets/images/dealapp.png");
// Official symbols/light-surface variants avoid white wordmarks and opaque backing tiles.
LOGOS["Aqarcity"] = require("../../assets/images/aqarcity-logo.png");
LOGOS["Ramzalqasim"] = require("../../assets/images/ramzalqassim.png");
LOGOS["Amaall"] = require("../../assets/images/amaall.png");
LOGOS["Alta"] = require("../../assets/images/alta.png");
LOGOS["Awal"] = require("../../assets/images/awal.png");
LOGOS["Waslna"] = require("../../assets/images/wslnaa.png");
LOGOS["نفوذ"] = require("../../assets/images/nufouth.png");
LOGOS["آل سعيدان"] = require("../../assets/images/alsaedan.png");
LOGOS["منصات"] = require("../../assets/images/platform-clean/menassat.png");
LOGOS["آل متعب العقارية"] = require("../../assets/images/platform-clean/almuteb.png");
LOGOS["Flow"] = require("../../assets/images/platform-clean/flow.png");
LOGOS["Maqam Al Wisam"] = require("../../assets/images/platform-clean/maqam.png");
LOGOS["راز العقارية"] = require("../../assets/images/platform-clean/raz.png");
LOGOS["الرفاعي للعقار"] = require("../../assets/images/platform-clean/alrifai-small.png");
LOGOS["MAQRAT"] = require("../../assets/images/platform-clean/maqrat.png");
const coverage = coverageSnapshot.platforms as Record<string, PickerCoverage>;
export const PLATFORM_PICKER_PROFILES: Record<string, PlatformPickerProfile> = Object.fromEntries(
  Object.entries(LOGOS).map(([name, logo]) => [name, {
    logo, group: { ar: platformCoverageGroup(coverage[name], 'ar'), en: platformCoverageGroup(coverage[name], 'en') }, layout: logoLayout[name as keyof typeof logoLayout], ar: platformCoverageSentence(coverage[name], 'ar'), en: platformCoverageSentence(coverage[name], 'en'),
  }]),
);

export function pickerSourceSlugs(names: string[]): string[] {
  return [...new Set(names.flatMap(name => {
    const entry = coverageSnapshot.platforms[name as keyof typeof coverageSnapshot.platforms];
    if (!entry?.slugs.length) throw new Error(`Unknown picker source: ${name}`);
    return entry.slugs;
  }))];
}
// Deep search is a FOCUSED search (owner 2026-10-10: «for the deep search we allow how many websites he can
// choose … let's make it 3»). A 4th pick is refused here — the one function every pick goes through — and the
// sheet shows the limit and dims the rows that cannot be added. Removing a site is always allowed.
export const MAX_PICKER_SOURCES = 3;
export function togglePickerSource(names: string[], name: string): string[] {
  if (names.includes(name)) return names.filter(value => value !== name);
  return names.length >= MAX_PICKER_SOURCES ? names : [...names, name];
}

export function applyPickerSources<Q extends { sources?: string[] }>(query: Q, slugs: string[], explicit: boolean): Q {
  return explicit ? { ...query, sources: slugs.slice() } : query;
}
