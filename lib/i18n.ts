// i18n = "internationalization": the system that lets the menu speak 6 languages.
// This file holds the dictionary of UI words (buttons, labels) per language, plus
// two small React "hooks" that tell a component which language is currently active.

import { useState, useEffect } from "react";
import { type LanguageCode } from "./format";

// The list of every UI phrase the app needs to translate. Think of it as the
// "keys" in our dictionary — each language below must fill in all of these.
export interface Translations {
  greeting: string;
  heroTitle: string;
  categories: string;
  slide: string;
  searchPlaceholder: string;
  filterAll: string;
  filterVeg: string;
  filterNonVeg: string;
  filterChef: string;      // "Chef's Special" filter chip
  filterFav: string;       // "Favorites" filter chip
  sortTopRated: string;    // "Top Rated" sort chip
  sortLowPrice: string;    // "Low Price" sort chip
  catAll: string;
  catBurgers: string;
  catPizza: string;
  catSushi: string;
  catPasta: string;
  catSalads: string;
  addToCart: string;
  viewIn3D: string;
  preview3dUnavailable: string;
  backToMenu: string;
  submitReview: string;
  readMore: string;
  readLess: string;
  ingredients: string;
  aboutDish: string;
  customerReviews: string;
  rateThisDish: string;
  yourName: string;
  sharePlaceholder: string;
  youMightLike: string;
  previous: string;
  next: string;
  startingPrice: string;
  cal: string;
  protein: string;
  carbs: string;
  sugar: string;
  price: string;
  loadingLabel: string;
  itemNotFound: string;
  itemNotFoundDesc: string;
  tabRate: string;
  tabReviews: string;
  review: string;
  reviews: string;
  prepTime: string;
  newDish: string; // badge for dishes with no real reviews yet
  // The 3D viewer's own chrome. It was the ONE guest screen still hardcoded in
  // English while the menu and dish page around it translated, so a Hindi or
  // Korean diner met a wall of English the moment they opened 3D (guest sweep
  // 2026-08-04). "contains" is shared with the dish page's allergen heading.
  loading3d: string;
  arView: string;
  addToOrder: string;
  back: string;
  contains: string;
  tripleTapReplay: string;
  // I5 (owner asked for it, 2026-08-12): nothing on screen told a diner the 3D dish can be TURNED.
  // The 3D dish is the whole point of this product and it relied on people fiddling to discover it.
  // Shown once, briefly, when the model first appears — the same quiet pill as tripleTapReplay.
  dragToSpin: string;
  notAvailable: string; // a sold-out dish's button label, shared by the dish page and 3D view
  // The menu's EMPTY states. They were hardcoded English on a screen whose chips, headings and
  // search box all translate, so a Hindi guest whose search found nothing was told what to do
  // next in a language they may not read (T15 sweep, 2026-08-05).
  noDishesYet: string;
  noDishesYetSub: string;
  noFavourites: string;
  // The Favourites empty screen used to translate its HEADLINE and then tell the guest what to
  // do about it in hardcoded English — on a menu that offers Hindi (guest sweep T1, 2026-08-06).
  // `noFavouritesSub` carries a `{heart}` token where the ♥ icon is drawn, so the sentence can be
  // ordered naturally in each language instead of being glued together from fragments.
  noFavouritesSub: string;
  favTapToSave: string;      // the little cue under the how-to card
  // A dish with ratings switched ON but no reviews yet. The card used to show NOTHING in that
  // slot, so a guest could not tell an unrated dish from a restaurant that has ratings turned
  // off — and after the invented "25-30 min" was removed the row was often empty altogether.
  // Deliberately lower case and muted: the owner turned down a "New" BADGE here in June 2026,
  // so this is a quiet line of text, not a decoration. (T1 improvement 4, 2026-08-07.)
  noRatingsYet: string;
  noMatch: string;
  noMatchSub: string;
  noSearchResults: string;   // takes the typed term, e.g. `No dishes found for “{q}”`
  noSearchResultsSub: string;
}

// The dictionary itself: one complete set of phrases per language code.
// To translate a button, find its key (e.g. "addToCart") under every language.
const translations: Record<LanguageCode, Translations> = {
  en: {
    noDishesYet: "No dishes on the menu yet.",
    noDishesYetSub: "This restaurant hasn\u2019t added any dishes. Please check back soon.",
    noFavourites: "No favourites yet.",
    favTapToSave: "tap to save",
    noRatingsYet: "no ratings yet",
    noFavouritesSub: "Open any dish, then tap the {heart} at the top-right \u2014 it stays saved here for next time.",
    noMatch: "No dishes match these filters.",
    noMatchSub: "Try turning a filter off.",
    noSearchResults: "No dishes found for \u201c{q}\u201d",
    noSearchResultsSub: "Try a different word, or check your spelling.",
    greeting: "BONJOUR",
    heroTitle: "All-Day Café & Bakery",
    categories: "CATEGORIES",
    slide: "Swipe",
    searchPlaceholder: "Search dishes…",
    filterAll: "All",
    filterVeg: "🌿 Veg",
    filterNonVeg: "🍖 Non-Veg",
    filterChef: "⭐ Chef\u2019s special",
    filterFav: "❤️ Favourites",
    sortTopRated: "⭐ Top rated",
    sortLowPrice: "↓ Low price",
    catAll: "All",
    catBurgers: "Burgers",
    catPizza: "Pizza",
    catSushi: "Sushi",
    catPasta: "Pasta",
    catSalads: "Salads",
    addToCart: "Add to order",
    viewIn3D: "View in 3D",
    preview3dUnavailable: "3D preview unavailable",
    backToMenu: "Back to menu",
    submitReview: "Send review",
    readMore: "Read more ↓",
    readLess: "Read less ↑",
    ingredients: "Ingredients",
    aboutDish: "About this dish",
    customerReviews: "Customer reviews",
    rateThisDish: "Rate this dish",
    yourName: "Your name",
    sharePlaceholder: "Share your thoughts about this dish…",
    youMightLike: "You might also like",
    previous: "Previous",
    next: "Next",
    startingPrice: "Starting price",
    cal: "Calories",
    protein: "Protein",
    carbs: "Carbs",
    sugar: "Sugar",
    price: "Price",
    loadingLabel: "Plating your dish",
    itemNotFound: "Dish not found",
    itemNotFoundDesc: "That dish isn\u2019t on the menu any more.",
    tabRate: "Rate dish",
    tabReviews: "Reviews",
    newDish: "New",
    review: "review",
    reviews: "reviews",
    prepTime: "Prep",
    loading3d: "Loading 3D model",
    arView: "AR View",
    addToOrder: "Add to order",
    back: "Back",
    contains: "Contains",
    tripleTapReplay: "Triple-tap to replay",
    dragToSpin: "Drag to turn it around",
    notAvailable: "Not available",
  },
  de: {
    noDishesYet: "Noch keine Gerichte auf der Karte",
    noDishesYetSub: "Dieses Restaurant hat noch keine Gerichte hinzugef\u00fcgt. Bitte schauen Sie bald wieder vorbei.",
    noFavourites: "Noch keine Favoriten",
    favTapToSave: "zum Speichern tippen",
    noRatingsYet: "noch keine Bewertungen",
    noFavouritesSub: "\u00d6ffnen Sie ein Gericht und tippen Sie oben rechts auf das {heart} \u2014 es bleibt hier gespeichert.",
    noMatch: "Keine Gerichte passen zu diesen Filtern.",
    noMatchSub: "Schalten Sie einen Filter aus.",
    noSearchResults: "Keine Gerichte gefunden f\u00fcr \u201e{q}\u201c",
    noSearchResultsSub: "Versuchen Sie ein anderes Wort oder pr\u00fcfen Sie die Schreibweise.",
    greeting: "HERZLICH WILLKOMMEN",
    heroTitle: "Ganztags Café & Bäckerei",
    categories: "KATEGORIEN",
    slide: "Wischen",
    searchPlaceholder: "Gerichte suchen…",
    filterAll: "Alle",
    filterVeg: "🌿 Vegetarisch",
    filterNonVeg: "🍖 Nicht vegetarisch",
    filterChef: "⭐ Chef-Empfehlung",
    filterFav: "❤️ Favoriten",
    sortTopRated: "⭐ Top bewertet",
    sortLowPrice: "↓ Günstigster Preis",
    catAll: "Alle",
    catBurgers: "Burger",
    catPizza: "Pizza",
    catSushi: "Sushi",
    catPasta: "Pasta",
    catSalads: "Salate",
    addToCart: "Zur Bestellung",
    viewIn3D: "In 3D ansehen",
    preview3dUnavailable: "3D-Vorschau nicht verfügbar",
    backToMenu: "Zurück zum Menü",
    submitReview: "Bewertung senden",
    readMore: "Mehr lesen ↓",
    readLess: "Weniger ↑",
    ingredients: "Zutaten",
    aboutDish: "Über dieses Gericht",
    customerReviews: "Kundenbewertungen",
    rateThisDish: "Dieses Gericht bewerten",
    yourName: "Ihr Name",
    sharePlaceholder: "Teilen Sie Ihre Gedanken…",
    youMightLike: "Das könnte Ihnen gefallen",
    previous: "Vorherige",
    next: "Nächste",
    startingPrice: "Ab Preis",
    cal: "Kal",
    protein: "Protein",
    carbs: "Kohlenhydrate",
    sugar: "Zucker",
    price: "Preis",
    loadingLabel: "Ihr Gericht wird vorbereitet",
    itemNotFound: "Gericht nicht gefunden",
    itemNotFoundDesc: "Der gesuchte Artikel existiert nicht.",
    tabRate: "Bewerten",
    tabReviews: "Bewertungen",
    newDish: "Neu",
    review: "Bewertung",
    reviews: "Bewertungen",
    // Was the English word "Prep" — the only value in any non-English block that had never been
    // translated (T4 sweep, 2026-08-17). It is the short label on a dish card's prep-time line, so
    // a German diner read an English abbreviation on a card whose every other word was German.
    // "Zub." is the ordinary German shortening of Zubereitung, and it is the same length as the
    // other languages' labels, so no card re-flows.
    prepTime: "Zub.",
    loading3d: "3D-Modell wird geladen",
    arView: "AR-Ansicht",
    addToOrder: "Zur Bestellung",
    back: "Zurück",
    contains: "Enthält",
    tripleTapReplay: "Dreimal tippen zum Wiederholen",
    dragToSpin: "Ziehen, um es zu drehen",
    notAvailable: "Nicht verfügbar",
  },
  fr: {
    noDishesYet: "Aucun plat au menu pour l\u2019instant",
    noDishesYetSub: "Ce restaurant n\u2019a pas encore ajout\u00e9 de plats. Revenez bient\u00f4t.",
    noFavourites: "Aucun favori pour l\u2019instant",
    favTapToSave: "touchez pour enregistrer",
    noRatingsYet: "pas encore d\u2019avis",
    noFavouritesSub: "Ouvrez un plat, puis touchez le {heart} en haut \u00e0 droite \u2014 il reste enregistr\u00e9 ici.",
    noMatch: "Aucun plat ne correspond \u00e0 ces filtres.",
    noMatchSub: "Essayez de d\u00e9sactiver un filtre.",
    noSearchResults: "Aucun plat trouv\u00e9 pour \u00ab\u202f{q}\u202f\u00bb",
    noSearchResultsSub: "Essayez un autre mot, ou v\u00e9rifiez l\u2019orthographe.",
    greeting: "BONJOUR",
    heroTitle: "Café & Boulangerie Toute la Journée",
    categories: "CATÉGORIES",
    slide: "Glisser",
    searchPlaceholder: "Rechercher des plats…",
    filterAll: "Tout",
    filterVeg: "🌿 Végé",
    filterNonVeg: "🍖 Non-Végé",
    filterChef: "⭐ Spécialité du chef",
    filterFav: "❤️ Favoris",
    sortTopRated: "⭐ Les mieux notés",
    sortLowPrice: "↓ Prix bas",
    catAll: "Tout",
    catBurgers: "Burgers",
    catPizza: "Pizza",
    catSushi: "Sushis",
    catPasta: "Pâtes",
    catSalads: "Salades",
    addToCart: "Ajouter à la commande",
    viewIn3D: "Voir en 3D",
    preview3dUnavailable: "Aperçu 3D indisponible",
    backToMenu: "Retour au menu",
    submitReview: "Soumettre l\u2019avis",
    readMore: "Lire plus ↓",
    readLess: "Lire moins ↑",
    ingredients: "Ingrédients",
    aboutDish: "À propos de ce plat",
    customerReviews: "Avis des clients",
    rateThisDish: "Évaluer ce plat",
    yourName: "Votre nom",
    sharePlaceholder: "Partagez vos impressions…",
    youMightLike: "Vous pourriez aussi aimer",
    previous: "Précédent",
    next: "Suivant",
    startingPrice: "Prix de départ",
    cal: "Cal",
    protein: "Protéines",
    carbs: "Glucides",
    sugar: "Sucre",
    price: "Prix",
    loadingLabel: "Préparation de votre plat",
    itemNotFound: "Plat introuvable",
    itemNotFoundDesc: "L\u2019article que vous cherchez n\u2019existe pas.",
    tabRate: "Évaluer",
    tabReviews: "Avis",
    newDish: "Nouveau",
    review: "avis",
    reviews: "avis",
    prepTime: "Prép",
    loading3d: "Chargement du modèle 3D",
    arView: "Vue RA",
    addToOrder: "Ajouter à la commande",
    back: "Retour",
    contains: "Contient",
    tripleTapReplay: "Triple-tapez pour rejouer",
    dragToSpin: "Faites glisser pour le tourner",
    notAvailable: "Non disponible",
  },
  ar: {
    noDishesYet: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0637\u0628\u0627\u0642 \u0641\u064a \u0627\u0644\u0642\u0627\u0626\u0645\u0629 \u0628\u0639\u062f",
    noDishesYetSub: "\u0644\u0645 \u064a\u0636\u0641 \u0647\u0630\u0627 \u0627\u0644\u0645\u0637\u0639\u0645 \u0623\u064a \u0623\u0637\u0628\u0627\u0642 \u0628\u0639\u062f. \u064a\u0631\u062c\u0649 \u0627\u0644\u0639\u0648\u062f\u0629 \u0642\u0631\u064a\u0628\u064b\u0627.",
    noFavourites: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0645\u0641\u0636\u0644\u0627\u062a \u0628\u0639\u062f",
    favTapToSave: "\u0627\u0636\u063a\u0637 \u0644\u0644\u062d\u0641\u0638",
    noRatingsYet: "\u0644\u0627 \u062a\u0642\u064a\u064a\u0645\u0627\u062a \u0628\u0639\u062f",
    noFavouritesSub: "\u0627\u0641\u062a\u062d \u0623\u064a \u0637\u0628\u0642\u060c \u062b\u0645 \u0627\u0636\u063a\u0637 \u0639\u0644\u0649 {heart} \u0641\u064a \u0627\u0644\u0623\u0639\u0644\u0649 \u2014 \u0633\u064a\u0628\u0642\u0649 \u0645\u062d\u0641\u0648\u0638\u064b\u0627 \u0647\u0646\u0627.",
    noMatch: "\u0644\u0627 \u062a\u0648\u062c\u062f \u0623\u0637\u0628\u0627\u0642 \u062a\u0637\u0627\u0628\u0642 \u0647\u0630\u0647 \u0627\u0644\u0645\u0631\u0634\u062d\u0627\u062a.",
    noMatchSub: "\u062c\u0631\u0651\u0628 \u0625\u064a\u0642\u0627\u0641 \u0623\u062d\u062f \u0627\u0644\u0645\u0631\u0634\u062d\u0627\u062a.",
    noSearchResults: "\u0644\u0645 \u064a\u062a\u0645 \u0627\u0644\u0639\u062b\u0648\u0631 \u0639\u0644\u0649 \u0623\u0637\u0628\u0627\u0642 \u0644\u0640 \u201c{q}\u201d",
    noSearchResultsSub: "\u062c\u0631\u0651\u0628 \u0643\u0644\u0645\u0629 \u0623\u062e\u0631\u0649\u060c \u0623\u0648 \u062a\u062d\u0642\u0642 \u0645\u0646 \u0627\u0644\u0625\u0645\u0644\u0627\u0621.",
    greeting: "أهلاً وسهلاً",
    heroTitle: "مقهى ومخبز طوال اليوم",
    categories: "الفئات",
    slide: "اسحب",
    searchPlaceholder: "ابحث عن الأطباق…",
    filterAll: "الكل",
    filterVeg: "🌿 نباتي",
    filterNonVeg: "🍖 غير نباتي",
    filterChef: "⭐ اختيار الشيف",
    filterFav: "❤️ المفضلة",
    sortTopRated: "⭐ الأعلى تقييماً",
    sortLowPrice: "↓ السعر الأقل",
    catAll: "الكل",
    catBurgers: "برجر",
    catPizza: "بيتزا",
    catSushi: "سوشي",
    catPasta: "باستا",
    catSalads: "سلطات",
    addToCart: "أضف إلى الطلب",
    viewIn3D: "عرض ثلاثي الأبعاد",
    preview3dUnavailable: "المعاينة 3D غير متاحة",
    backToMenu: "العودة للقائمة",
    submitReview: "إرسال التقييم",
    readMore: "قراءة المزيد ↓",
    readLess: "قراءة أقل ↑",
    ingredients: "المكونات",
    aboutDish: "عن هذا الطبق",
    customerReviews: "آراء العملاء",
    rateThisDish: "قيّم هذا الطبق",
    yourName: "اسمك",
    sharePlaceholder: "شاركنا رأيك…",
    youMightLike: "قد يعجبك أيضاً",
    previous: "السابق",
    next: "التالي",
    startingPrice: "السعر الابتدائي",
    cal: "سعرة",
    protein: "بروتين",
    carbs: "كربوهيدرات",
    sugar: "سكر",
    price: "السعر",
    loadingLabel: "يتم تجهيز طبقك",
    itemNotFound: "العنصر غير موجود",
    itemNotFoundDesc: "العنصر الذي تبحث عنه غير موجود.",
    tabRate: "قيّم",
    tabReviews: "التقييمات",
    newDish: "جديد",
    review: "تقييم",
    reviews: "تقييمات",
    prepTime: "وقت",
    loading3d: "جارٍ تحميل المجسم ثلاثي الأبعاد",
    arView: "عرض الواقع المعزز",
    addToOrder: "أضف إلى الطلب",
    back: "رجوع",
    contains: "يحتوي على",
    tripleTapReplay: "انقر ثلاث مرات للإعادة",
    dragToSpin: "\u0627\u0633\u062d\u0628 \u0644\u062a\u062f\u0648\u064a\u0631\u0647",
    notAvailable: "غير متوفر",
  },
  hi: {
    noDishesYet: "\u092e\u0947\u0928\u0942 \u092e\u0947\u0902 \u0905\u092d\u0940 \u0915\u094b\u0908 \u0935\u094d\u092f\u0902\u091c\u0928 \u0928\u0939\u0940\u0902",
    noDishesYetSub: "\u0907\u0938 \u0930\u0947\u0938\u094d\u091f\u0949\u0930\u0947\u0902\u091f \u0928\u0947 \u0905\u092d\u0940 \u0915\u094b\u0908 \u0935\u094d\u092f\u0902\u091c\u0928 \u0928\u0939\u0940\u0902 \u091c\u094b\u0921\u093c\u093e \u0939\u0948\u0964 \u0915\u0943\u092a\u092f\u093e \u091c\u0932\u094d\u0926 \u0939\u0940 \u0926\u094b\u092c\u093e\u0930\u093e \u0926\u0947\u0916\u0947\u0902\u0964",
    noFavourites: "\u0905\u092d\u0940 \u0915\u094b\u0908 \u092a\u0938\u0902\u0926\u0940\u0926\u093e \u0928\u0939\u0940\u0902",
    favTapToSave: "\u0938\u0939\u0947\u091c\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f \u091f\u0948\u092a \u0915\u0930\u0947\u0902",
    noRatingsYet: "\u0905\u092d\u0940 \u0915\u094b\u0908 \u0930\u0947\u091f\u093f\u0902\u0917 \u0928\u0939\u0940\u0902",
    noFavouritesSub: "\u0915\u094b\u0908 \u092d\u0940 \u0935\u094d\u092f\u0902\u091c\u0928 \u0916\u094b\u0932\u0947\u0902, \u092b\u093f\u0930 \u090a\u092a\u0930 \u0926\u093e\u0908\u0902 \u0913\u0930 {heart} \u092a\u0930 \u091f\u0948\u092a \u0915\u0930\u0947\u0902 \u2014 \u092f\u0939 \u092f\u0939\u093e\u0901 \u0938\u0939\u0947\u091c\u093e \u0930\u0939\u0947\u0917\u093e\u0964",
    noMatch: "\u0907\u0928 \u092b\u093c\u093f\u0932\u094d\u091f\u0930 \u0938\u0947 \u0915\u094b\u0908 \u0935\u094d\u092f\u0902\u091c\u0928 \u092e\u0947\u0932 \u0928\u0939\u0940\u0902 \u0916\u093e\u0924\u093e\u0964",
    noMatchSub: "\u0915\u094b\u0908 \u090f\u0915 \u092b\u093c\u093f\u0932\u094d\u091f\u0930 \u092c\u0902\u0926 \u0915\u0930\u0915\u0947 \u0926\u0947\u0916\u0947\u0902\u0964",
    noSearchResults: "\u201c{q}\u201d \u0915\u0947 \u0932\u093f\u090f \u0915\u094b\u0908 \u0935\u094d\u092f\u0902\u091c\u0928 \u0928\u0939\u0940\u0902 \u092e\u093f\u0932\u093e",
    noSearchResultsSub: "\u0915\u094b\u0908 \u0926\u0942\u0938\u0930\u093e \u0936\u092c\u094d\u0926 \u0906\u091c\u092e\u093e\u090f\u0901, \u092f\u093e \u0935\u0930\u094d\u0924\u0928\u0940 \u091c\u093e\u0901\u091a\u0947\u0902\u0964",
    greeting: "नमस्ते",
    heroTitle: "ऑल-डे कैफ़े और बेकरी",
    categories: "श्रेणियां",
    slide: "स्लाइड करें",
    searchPlaceholder: "व्यंजन खोजें…",
    filterAll: "सभी",
    filterVeg: "🌿 शाकाहारी",
    filterNonVeg: "🍖 मांसाहारी",
    filterChef: "⭐ शेफ स्पेशल",
    filterFav: "❤️ पसंदीदा",
    sortTopRated: "⭐ टॉप रेटेड",
    sortLowPrice: "↓ कम कीमत",
    catAll: "सभी",
    catBurgers: "बर्गर",
    catPizza: "पिज्जा",
    catSushi: "सुशी",
    catPasta: "पास्ता",
    catSalads: "सलाद",
    addToCart: "ऑर्डर में जोड़ें",
    viewIn3D: "3D में देखें",
    preview3dUnavailable: "3D पूर्वावलोकन उपलब्ध नहीं",
    backToMenu: "मेनू पर वापस",
    submitReview: "समीक्षा सबमिट करें",
    readMore: "और पढ़ें ↓",
    readLess: "कम पढ़ें ↑",
    ingredients: "सामग्री",
    aboutDish: "इस व्यंजन के बारे में",
    customerReviews: "ग्राहक समीक्षाएं",
    rateThisDish: "इस व्यंजन को रेट करें",
    yourName: "आपका नाम",
    sharePlaceholder: "अपने विचार साझा करें…",
    youMightLike: "आपको यह भी पसंद आ सकता है",
    previous: "पिछला",
    next: "अगला",
    startingPrice: "शुरुआती कीमत",
    cal: "कैलोरी",
    protein: "प्रोटीन",
    carbs: "कार्ब्स",
    sugar: "शुगर",
    price: "कीमत",
    loadingLabel: "आपका व्यंजन तैयार हो रहा है",
    itemNotFound: "आइटम नहीं मिला",
    itemNotFoundDesc: "आप जिस आइटम की तलाश में हैं वह मौजूद नहीं है।",
    tabRate: "रेट करें",
    tabReviews: "समीक्षाएं",
    newDish: "नया",
    review: "समीक्षा",
    reviews: "समीक्षाएं",
    prepTime: "समय",
    loading3d: "3D मॉडल लोड हो रहा है",
    arView: "AR व्यू",
    addToOrder: "ऑर्डर में जोड़ें",
    back: "पीछे",
    contains: "इसमें है",
    tripleTapReplay: "दोहराने के लिए तीन बार टैप करें",
    dragToSpin: "\u0918\u0941\u092e\u093e\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f \u0938\u094d\u0932\u093e\u0907\u0921 \u0915\u0930\u0947\u0902",
    notAvailable: "उपलब्ध नहीं",
  },
  ko: {
    noDishesYet: "\uc544\uc9c1 \uba54\ub274\uc5d0 \uc694\ub9ac\uac00 \uc5c6\uc2b5\ub2c8\ub2e4",
    noDishesYetSub: "\uc774 \uc2dd\ub2f9\uc740 \uc544\uc9c1 \uc694\ub9ac\ub97c \ub4f1\ub85d\ud558\uc9c0 \uc54a\uc558\uc2b5\ub2c8\ub2e4. \uacf1 \ub2e4\uc2dc \ud655\uc778\ud574 \uc8fc\uc138\uc694.",
    noFavourites: "\uc990\uaca8\ucc3e\uae30\uac00 \uc544\uc9c1 \uc5c6\uc2b5\ub2c8\ub2e4",
    favTapToSave: "\ub20c\ub7ec\uc11c \uc800\uc7a5",
    noRatingsYet: "\uc544\uc9c1 \ud3c9\uac00 \uc5c6\uc74c",
    noFavouritesSub: "\uc694\ub9ac\ub97c \uc5f4\uace0 \uc624\ub978\ucabd \uc704\uc758 {heart}\ub97c \ub204\ub974\uc138\uc694 \u2014 \uc5ec\uae30\uc5d0 \uc800\uc7a5\ub429\ub2c8\ub2e4.",
    noMatch: "\uc774 \ud544\ud130\uc5d0 \ub9de\ub294 \uc694\ub9ac\uac00 \uc5c6\uc2b5\ub2c8\ub2e4.",
    noMatchSub: "\ud544\ud130\ub97c \ud558\ub098 \uaebc\ubcf4\uc138\uc694.",
    noSearchResults: "\u201c{q}\u201d\uc5d0 \ub300\ud55c \uc694\ub9ac\ub97c \ucc3e\uc744 \uc218 \uc5c6\uc2b5\ub2c8\ub2e4",
    noSearchResultsSub: "\ub2e4\ub978 \ub2e8\uc5b4\ub97c \uc2dc\ub3c4\ud558\uac70\ub098 \ucca0\uc790\ub97c \ud655\uc778\ud574 \uc8fc\uc138\uc694.",
    greeting: "안녕하세요",
    heroTitle: "올데이 카페 & 베이커리",
    categories: "카테고리",
    slide: "스와이프",
    searchPlaceholder: "요리 검색…",
    filterAll: "전체",
    filterVeg: "🌿 채식",
    filterNonVeg: "🍖 비채식",
    filterChef: "⭐ 셰프 추천",
    filterFav: "❤️ 즐겨찾기",
    sortTopRated: "⭐ 최고 평점",
    sortLowPrice: "↓ 낮은 가격",
    catAll: "전체",
    catBurgers: "버거",
    catPizza: "피자",
    catSushi: "스시",
    catPasta: "파스타",
    catSalads: "샐러드",
    addToCart: "주문에 추가",
    viewIn3D: "3D로 보기",
    preview3dUnavailable: "3D 미리보기 불가",
    backToMenu: "메뉴로 돌아가기",
    submitReview: "리뷰 제출",
    readMore: "더 보기 ↓",
    readLess: "접기 ↑",
    ingredients: "재료",
    aboutDish: "이 요리에 대해",
    customerReviews: "고객 리뷰",
    rateThisDish: "이 요리 평가하기",
    yourName: "이름",
    sharePlaceholder: "의견을 공유해주세요…",
    youMightLike: "이런 것도 좋아하실 수 있어요",
    previous: "이전",
    next: "다음",
    startingPrice: "시작 가격",
    cal: "칼로리",
    protein: "단백질",
    carbs: "탄수화물",
    sugar: "당",
    price: "가격",
    loadingLabel: "요리를 준비 중입니다",
    itemNotFound: "항목을 찾을 수 없음",
    itemNotFoundDesc: "찾으시는 항목이 존재하지 않습니다.",
    tabRate: "평가하기",
    tabReviews: "리뷰",
    newDish: "신메뉴",
    review: "리뷰",
    reviews: "리뷰",
    prepTime: "시간",
    loading3d: "3D 모델 불러오는 중",
    arView: "AR 보기",
    addToOrder: "주문에 추가",
    back: "뒤로",
    contains: "포함 성분",
    tripleTapReplay: "세 번 탭하여 다시 재생",
    dragToSpin: "\ub4dc\ub798\uadf8\ud558\uc5ec \ub3cc\ub824\ubcf4\uc138\uc694",
    notAvailable: "판매 종료",
  },
};

// A DEVICE THAT REFUSES STORAGE MUST STILL GET A MENU.
//
// `localStorage` is not always a readable property. A browser set to block all site data throws
// SecurityError from the GETTER itself — so even `typeof localStorage` throws, and a bare
// `localStorage.getItem(...)` certainly does. This read used to be bare, and it sits inside a
// useEffect: a throw there takes the whole React tree down, it isn't caught anywhere, and the
// person gets Next's error screen instead of the menu.
//
// Measured on the production build with storage blocked (T4 sweep, 2026-08-17): the guest menu
// rendered "Something went wrong", zero dishes, `SecurityError: The operation is insecure.` in the
// console — for a diner who has simply turned cookies off in their phone's browser. Every other
// place in the app that reads this key already wraps it (lib/guestDevice.ts says so in as many
// words: "returns '' if storage is unavailable"); this was the one that didn't.
//
// English is the right fallback: the picker's own default, and the language the dictionary is
// complete in. The person can still change it for the session — the change simply isn't remembered,
// which is what "storage is blocked" means.
const readLang = (): LanguageCode => {
  try {
    return (localStorage.getItem("lfh_language") as LanguageCode) || "en";
  } catch {
    return "en";
  }
};

// The current language code (e.g. "en", "de"). Use this when the text you need
// is NOT in the static translations table — e.g. database-driven category and
// filter names, which carry their own per-language strings.
export const useLanguage = (): LanguageCode => {
  // "state" is a value React watches; when it changes, the component re-draws.
  // We start by assuming English, then correct it once we're in the browser.
  const [lang, setLang] = useState<LanguageCode>("en");

  // useEffect runs after the component appears on screen (only in the browser).
  useEffect(() => {
    // Read the saved language from localStorage (key "lfh_language").
    setLang(readLang());
    // This little function re-reads the language whenever it changes elsewhere.
    const onLang = () => {
      setLang(readLang());
    };
    // Listen for the "lfh:language-changed" announcement fired by setLanguage().
    window.addEventListener("lfh:language-changed", onLang);
    // Clean up the listener when the component goes away, so we don't leak it.
    return () => window.removeEventListener("lfh:language-changed", onLang);
  }, []); // empty [] means "set this up just once"

  return lang;
};

// ── DON'T OFFER TO FINISH THE TRANSLATION. IT IS NOT ON THE LIST. ─────────────────────────────
//
// REJECTED (owner, 2026-08-14) — docs/REJECTED-IDEAS.md → R23. The language picker and the
// currency picker STAY on the guest menu exactly as they are; what is rejected is *raising this as
// work*: *"you don't have to remove option … what I wanted is just don't suggest that improvement
// right now."*
//
// So do not put either of these in front of him again as a problem or an improvement:
//
//  1. **"The ordering flow is still English."** Measured by the T15 sweep, 2026-08-13, and true:
//     only FOUR files call useTranslation() — components/MenuView.tsx, components/FoodCard.tsx,
//     app/item/[slug]/ItemClient.tsx and app/view/[folder]/ViewerClient.tsx. The cart, the table
//     gate, the live order strip, the guest's bill, the waiter-call popup and the rating box are
//     hardcoded English, so a guest can BROWSE in हिन्दी and then has to ORDER in English. He knows.
//     It is parked, not missed. (R15 already said the same about three individual labels.)
//  2. **Arabic renders as disconnected letters** in the animated hero and the intro wordmark —
//     each grapheme sits in its own `display:inline-block` span (app/globals.css → the
//     `.hero-title-wrap … span` rule), and browsers cannot join Arabic across element boundaries,
//     so every letter falls back to its isolated form. Measured, with a screenshot, same sweep.
//     Note the claim in lib/brandText.ts's splitGraphemes header — *"Arabic benefits too — its
//     letters keep their joining forms"* — is WRONG; grapheme splitting fixes Devanagari but cannot
//     fix Arabic. Left here so nobody re-discovers it and files it as new.
//
// If he ever asks for languages properly, those two are the work — in that order. Until he does,
// they are recorded and closed. Do not re-report them, and do not "helpfully" start on them.
//
// useTranslation is the easy one components actually call: it gives back the
// whole phrase-set for the current language (falling back to English if missing).
export const useTranslation = (): Translations => {
  const lang = useLanguage();
  return translations[lang] || translations.en;
};
