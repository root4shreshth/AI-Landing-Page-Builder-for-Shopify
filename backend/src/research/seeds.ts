/**
 * Fallback starter list used ONLY when no search provider is available (no key / no credits / outage).
 * These are well-known Indian D2C brand storefronts per category group, labelled in the UI as
 * "starter list (search unavailable)". Every site is still robots-checked and crawled live; sites that fail
 * are reported as failed — nothing is assumed about their pages. The list can go stale; search is preferred.
 */
export const SEED_SITES: Record<string, string[]> = {
  apparel: ['https://www.snitch.com', 'https://www.thesouledstore.com', 'https://www.bonkerscorner.com', 'https://www.powerlook.in', 'https://www.urbanmonkey.com', 'https://www.bewakoof.com', 'https://www.rarerabbit.in', 'https://www.thehouseofrare.com', 'https://www.beyoung.in', 'https://www.offduty.in', 'https://www.bummer.in', 'https://www.nicobar.com'],
  footwear: ['https://www.neemans.com', 'https://www.bacca-bucci.com', 'https://www.comet.store', 'https://www.thebearhouse.com', 'https://www.solethreads.com', 'https://www.campusshoes.com', 'https://www.redtape.com', 'https://www.paaduks.com', 'https://www.yoho.store'],
  luggage: ['https://mokobara.com', 'https://www.nashermiles.com', 'https://uppercase.co.in', 'https://www.safaribags.com', 'https://www.vipbags.com', 'https://www.skybags.co.in', 'https://www.dailyobjects.com', 'https://www.zouk.co.in'],
  bags: ['https://uppercase.co.in', 'https://www.zouk.co.in', 'https://www.dailyobjects.com', 'https://mokobara.com', 'https://www.nashermiles.com', 'https://www.thelabellife.com', 'https://www.mywishbag.com', 'https://www.hidesign.com'],
  jewellery: ['https://www.giva.co', 'https://www.salty.co.in', 'https://www.palmonas.com', 'https://www.pipabella.com', 'https://www.zariin.com', 'https://www.isharya.com', 'https://www.voylla.com'],
  watches: ['https://www.fastrack.in', 'https://www.gonoise.com', 'https://www.boat-lifestyle.com', 'https://www.titan.co.in', 'https://www.firebolt.co.in'],
  beauty: ['https://beminimalist.co', 'https://plumgoodness.com', 'https://www.mcaffeine.com', 'https://thedermaco.com', 'https://www.dotandkey.com', 'https://www.foxtale.in', 'https://www.mamaearth.in', 'https://www.sugarcosmetics.com', 'https://www.deconstruct.co.in', 'https://www.bombayshavingcompany.com', 'https://www.beardo.in', 'https://www.ustraa.com'],
  electronics: ['https://www.boat-lifestyle.com', 'https://www.gonoise.com', 'https://www.boult.com', 'https://www.firebolt.co.in', 'https://www.ptron.in', 'https://www.mivi.in', 'https://www.ambraneindia.com', 'https://www.portronics.com'],
  food: ['https://www.thewholetruthfoods.com', 'https://www.slurrp.farm', 'https://www.sleepyowl.co', 'https://www.bluetokaicoffee.com', 'https://www.rageofcoffee.com', 'https://www.mypinkbox.in', 'https://www.yogabars.in', 'https://www.thebetterindia.com/shop', 'https://www.openhouse.in'],
  home: ['https://www.thesleepcompany.in', 'https://www.wakefit.co', 'https://www.ellementry.com', 'https://www.nestasia.in', 'https://www.thedecorkart.com', 'https://www.borosil.com', 'https://www.milton.in', 'https://www.chumbak.com'],
};

export function seedSitesFor(category: string | undefined): string[] {
  const c = category ?? '';
  if (/luggage|trolley|suitcase/.test(c)) return SEED_SITES.luggage;
  if (/bag|backpack|wallet|tote/.test(c)) return SEED_SITES.bags;
  if (/jewel|ring|necklace|earring/.test(c)) return SEED_SITES.jewellery;
  if (/watch/.test(c)) return SEED_SITES.watches;
  if (/groom|skin|hair|lip|beauty|cosmetic/.test(c)) return SEED_SITES.beauty;
  const group = c.split('/')[0];
  return SEED_SITES[group] ?? [];
}
