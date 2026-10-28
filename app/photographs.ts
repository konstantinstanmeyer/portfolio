import type { StaticImageData } from "next/image";
import parade from "@/images/photography/parade.jpg";
import p01 from "@/images/photography/01.jpg";
import p02 from "@/images/photography/02.jpg";
import p03 from "@/images/photography/03.jpg";
import p04 from "@/images/photography/04.jpg";
import p05 from "@/images/photography/05.jpg";
import p06 from "@/images/photography/06.jpg";
import p07 from "@/images/photography/07.jpg";
import p08 from "@/images/photography/08.jpg";
import p09 from "@/images/photography/09.jpg";
import p10 from "@/images/photography/10.jpg";
import p11 from "@/images/photography/11.jpg";
import p12 from "@/images/photography/12.jpg";
import p13 from "@/images/photography/13.jpg";
import p14 from "@/images/photography/14.jpg";
import p15 from "@/images/photography/15.jpg";
import p16 from "@/images/photography/16.jpg";
import p17 from "@/images/photography/17.jpg";
import p18 from "@/images/photography/18.jpg";
import p19 from "@/images/photography/19.jpg";
import p20 from "@/images/photography/20.jpg";
import p21 from "@/images/photography/21.jpg";
import p22 from "@/images/photography/22.jpg";
import p23 from "@/images/photography/23.jpg";
import p24 from "@/images/photography/24.jpg";
import p25 from "@/images/photography/25.jpg";
import p26 from "@/images/photography/26.jpg";
import p27 from "@/images/photography/27.jpg";
import p28 from "@/images/photography/28.jpg";
import p29 from "@/images/photography/29.jpg";

export type Photograph = { src: StaticImageData; alt: string };

// In display order. The first runs the full width of the section.
export const PHOTOGRAPHS: Photograph[] = [
  { src: parade, alt: "A night parade in Bali: runners carry a giant effigy on a bamboo frame through smoke, one man holding a flare aloft." },
  { src: p01, alt: "A woman in a hat lifts a sack of red chillies under a market's red awning, among bamboo baskets." },
  { src: p02, alt: "Black and white: a crowd gathered in a city park beneath tall buildings." },
  { src: p03, alt: "Black and white: a man carries a toddler along a city sidewalk; she stares at the camera while a little girl in front covers her ears." },
  { src: p04, alt: "Black and white: two dogs rest on a blanket against a building as a man walks past with a bicycle." },
  { src: p05, alt: "A girl in a gold costume glances aside while two more girls in tall flower headdresses walk up the path behind her." },
  { src: p06, alt: "Black and white: a man in a suit, phone to his ear, frowns at the camera on a busy street." },
  { src: p07, alt: "Black and white: a white-haired woman writes on a sheet of paper in a patch of sunlight in front of a shop window." },
  { src: p08, alt: "Black and white: people drawing and reading at folding tables at a street fair." },
  { src: p09, alt: "Black and white: folk dancers in traditional dress mid-turn, a woman in a headscarf smiling." },
  { src: p10, alt: "Dancers in gold costumes and tall floral headdresses, seen from below against a blue sky." },
  { src: p11, alt: "A girl in a gold costume and flower headdress raises her hand beside a man in white at a ceremony." },
  { src: p12, alt: "Black and white: an older man in a patterned shirt and a woman cross a city street." },
  { src: p13, alt: "A worker carries a sack on their head through a dim warehouse lined with stacked sacks." },
  { src: p14, alt: "A farmer bends among rice paddies, framed by leaning palm trunks." },
  { src: p15, alt: "Farmworkers in hats and hoods carry round baskets across a field under a stormy sky." },
  { src: p16, alt: "A crowded covered market under bright lamps, a masked woman holding a bag of fruit in the foreground." },
  { src: p17, alt: "A woman in profile in front of a busy market stall under red umbrellas." },
  { src: p18, alt: "A market street at night with a horse cart and a woman carrying a basket on her head." },
  { src: p19, alt: "An older woman pours rice and water from a basin into a pot while an older man sits on a wooden bench outside a concrete-block house." },
  { src: p20, alt: "A man bends in shallow sea water, two pleated buckets hung by rope from a pole across his shoulders." },
  { src: p21, alt: "A man and a woman carry a cloth sling of earth between them by the sea while a small child plays in the dirt." },
  { src: p22, alt: "A woman combs her hair in the courtyard of a tiled-roof house." },
  { src: p23, alt: "A band of sunlight across a dark concrete floor, a pig's trotters at its edge." },
  { src: p24, alt: "Four men ease a pig into a round wire cage beside a white wall." },
  { src: p25, alt: "A pig seen through the rings of a round wire cage as men steady it." },
  { src: p26, alt: "Cattle and a calf eat cut grass under trees while a shirtless man smokes behind them." },
  { src: p27, alt: "Two women winnow rice with round trays beside a field under a grey sky." },
  { src: p28, alt: "Hands harvesting long green onions, laid in bundles on dark soil." },
  { src: p29, alt: "Two women bundle trays of eggs beside rows of caged laying hens while a child sits on the steps with a phone." },
];
