import { useState, useEffect } from "react";
import { type LanguageCode } from "./format";

export interface Translations {
  greeting: string;
  heroTitle: string;
  categories: string;
  slide: string;
  searchPlaceholder: string;
  filterAll: string;
  filterVeg: string;
  filterNonVeg: string;
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
}

const translations: Record<LanguageCode, Translations> = {
  en: {
    greeting: "BONSOIR",
    heroTitle: "All-Day Café & Bakery",
    categories: "CATEGORIES",
    slide: "Slide",
    searchPlaceholder: "Search dishes...",
    filterAll: "All",
    filterVeg: "🌿 Veg",
    filterNonVeg: "🍖 Non-Veg",
    catAll: "All",
    catBurgers: "Burgers",
    catPizza: "Pizza",
    catSushi: "Sushi",
    catPasta: "Pasta",
    catSalads: "Salads",
    addToCart: "Add to Cart",
    viewIn3D: "View in 3D",
    preview3dUnavailable: "3D Preview Unavailable",
    backToMenu: "Back to Menu",
    submitReview: "Submit Review",
    readMore: "Read more ↓",
    readLess: "Read less ↑",
    ingredients: "Ingredients",
    aboutDish: "About this dish",
    customerReviews: "Customer Reviews",
    rateThisDish: "Rate this Dish",
    yourName: "Your name",
    sharePlaceholder: "Share your thoughts about this dish...",
    youMightLike: "You might also like",
    previous: "Previous",
    next: "Next",
    startingPrice: "Starting price",
    cal: "Cal",
    protein: "Protein",
    carbs: "Carbs",
    sugar: "Sugar",
    price: "Price",
    loadingLabel: "Plating your dish",
    itemNotFound: "Item not found",
    itemNotFoundDesc: "The item you're looking for doesn't exist.",
    tabRate: "Rate Dish",
    tabReviews: "Reviews",
    review: "review",
    reviews: "reviews",
    prepTime: "Prep",
  },
  de: {
    greeting: "GUTEN ABEND",
    heroTitle: "Ganztags Café & Bäckerei",
    categories: "KATEGORIEN",
    slide: "Wischen",
    searchPlaceholder: "Gerichte suchen...",
    filterAll: "Alle",
    filterVeg: "🌿 Veg",
    filterNonVeg: "🍖 Nicht-Veg",
    catAll: "Alle",
    catBurgers: "Burger",
    catPizza: "Pizza",
    catSushi: "Sushi",
    catPasta: "Pasta",
    catSalads: "Salate",
    addToCart: "Zum Warenkorb",
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
    sharePlaceholder: "Teilen Sie Ihre Gedanken...",
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
    itemNotFound: "Artikel nicht gefunden",
    itemNotFoundDesc: "Der gesuchte Artikel existiert nicht.",
    tabRate: "Bewerten",
    tabReviews: "Bewertungen",
    review: "Bewertung",
    reviews: "Bewertungen",
    prepTime: "Prep",
  },
  fr: {
    greeting: "BONSOIR",
    heroTitle: "Café & Boulangerie Toute la Journée",
    categories: "CATÉGORIES",
    slide: "Glisser",
    searchPlaceholder: "Rechercher des plats...",
    filterAll: "Tout",
    filterVeg: "🌿 Végé",
    filterNonVeg: "🍖 Non-Végé",
    catAll: "Tout",
    catBurgers: "Burgers",
    catPizza: "Pizza",
    catSushi: "Sushis",
    catPasta: "Pâtes",
    catSalads: "Salades",
    addToCart: "Ajouter au panier",
    viewIn3D: "Voir en 3D",
    preview3dUnavailable: "Aperçu 3D indisponible",
    backToMenu: "Retour au menu",
    submitReview: "Soumettre l'avis",
    readMore: "Lire plus ↓",
    readLess: "Lire moins ↑",
    ingredients: "Ingrédients",
    aboutDish: "À propos de ce plat",
    customerReviews: "Avis des clients",
    rateThisDish: "Évaluer ce plat",
    yourName: "Votre nom",
    sharePlaceholder: "Partagez vos impressions...",
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
    itemNotFound: "Article introuvable",
    itemNotFoundDesc: "L'article que vous cherchez n'existe pas.",
    tabRate: "Évaluer",
    tabReviews: "Avis",
    review: "avis",
    reviews: "avis",
    prepTime: "Prép",
  },
  ar: {
    greeting: "مساء الخير",
    heroTitle: "مقهى ومخبز طوال اليوم",
    categories: "الفئات",
    slide: "اسحب",
    searchPlaceholder: "ابحث عن الأطباق...",
    filterAll: "الكل",
    filterVeg: "🌿 نباتي",
    filterNonVeg: "🍖 غير نباتي",
    catAll: "الكل",
    catBurgers: "برجر",
    catPizza: "بيتزا",
    catSushi: "سوشي",
    catPasta: "باستا",
    catSalads: "سلطات",
    addToCart: "أضف إلى السلة",
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
    sharePlaceholder: "شاركنا رأيك...",
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
    review: "تقييم",
    reviews: "تقييمات",
    prepTime: "وقت",
  },
  hi: {
    greeting: "सुप्रभात",
    heroTitle: "ऑल-डे कैफ़े और बेकरी",
    categories: "श्रेणियां",
    slide: "स्लाइड करें",
    searchPlaceholder: "व्यंजन खोजें...",
    filterAll: "सभी",
    filterVeg: "🌿 शाकाहारी",
    filterNonVeg: "🍖 मांसाहारी",
    catAll: "सभी",
    catBurgers: "बर्गर",
    catPizza: "पिज्जा",
    catSushi: "सुशी",
    catPasta: "पास्ता",
    catSalads: "सलाद",
    addToCart: "कार्ट में जोड़ें",
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
    sharePlaceholder: "अपने विचार साझा करें...",
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
    review: "समीक्षा",
    reviews: "समीक्षाएं",
    prepTime: "समय",
  },
  ko: {
    greeting: "안녕하세요",
    heroTitle: "올데이 카페 & 베이커리",
    categories: "카테고리",
    slide: "스와이프",
    searchPlaceholder: "요리 검색...",
    filterAll: "전체",
    filterVeg: "🌿 채식",
    filterNonVeg: "🍖 비채식",
    catAll: "전체",
    catBurgers: "버거",
    catPizza: "피자",
    catSushi: "스시",
    catPasta: "파스타",
    catSalads: "샐러드",
    addToCart: "장바구니에 담기",
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
    sharePlaceholder: "의견을 공유해주세요...",
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
    review: "리뷰",
    reviews: "리뷰",
    prepTime: "시간",
  },
};

// The current language code (e.g. "en", "de"). Use this when the text you need
// is NOT in the static translations table — e.g. database-driven category and
// filter names, which carry their own per-language strings.
export const useLanguage = (): LanguageCode => {
  const [lang, setLang] = useState<LanguageCode>("en");

  useEffect(() => {
    setLang((localStorage.getItem("lfh_language") as LanguageCode) || "en");
    const onLang = () => {
      setLang((localStorage.getItem("lfh_language") as LanguageCode) || "en");
    };
    window.addEventListener("lfh:language-changed", onLang);
    return () => window.removeEventListener("lfh:language-changed", onLang);
  }, []);

  return lang;
};

export const useTranslation = (): Translations => {
  const lang = useLanguage();
  return translations[lang] || translations.en;
};
