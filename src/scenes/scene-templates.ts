export type SceneTemplate = {
  id: string;
  title: string;
  description: string;
  tags: string[];
  previewUrl: string;
  baseImageUrl: string;
  baseImageMimeType?: string;
  baseImageFileName?: string;
  prompt: string;
  aspectRatio: string;
  renderingSpeed?: 'DEFAULT' | 'TURBO';
  stylePreset?: string;
  styleType?: 'AUTO' | 'REALISTIC' | 'FICTION';
  styleOptionId?: string;
};

export type PublicSceneTemplate = Pick<
  SceneTemplate,
  'id' | 'title' | 'description' | 'tags' | 'previewUrl' | 'aspectRatio' | 'styleOptionId'
>;

export const SCENE_TEMPLATES: readonly SceneTemplate[] = [
  {
    id: 'helicopter-elephant',
    title: 'Helicopter with Elephant',
    description: 'Sit inside a military helicopter while a curious elephant peers through the door.',
    tags: ['cinematic', 'adventure', 'wildlife'],
    previewUrl: 'https://cdn.daygen.ai/scenes/helicopter-elephant-preview.jpg',
    baseImageUrl: 'https://cdn.daygen.ai/scenes/helicopter-elephant-base.png',
    baseImageMimeType: 'image/png',
    prompt:
      'Photorealistic interior of a helicopter cockpit with cinematic lighting, an elephant visible outside the open door. Insert the referenced person as the pilot, matching the lighting and camera perspective.',
    aspectRatio: '16x9',
    renderingSpeed: 'TURBO',
  },
  {
    id: 'moon-landing',
    title: 'On the Moon',
    description: 'Hero shot of an astronaut posing on the lunar surface with Earth looming in the background.',
    tags: ['sci-fi', 'space', 'dramatic'],
    previewUrl: 'https://cdn.daygen.ai/scenes/moon-landing-preview.jpg',
    baseImageUrl: 'https://cdn.daygen.ai/scenes/moon-landing-base.png',
    baseImageMimeType: 'image/png',
    prompt:
      'Ultra detailed moon landing scene with an astronaut in a reflective visor. Insert the referenced person as the astronaut, preserving helmet reflections and lunar dust lighting.',
    aspectRatio: '3x4',
    renderingSpeed: 'DEFAULT',
    stylePreset: 'CINEMATIC_REALISM',
  },
  {
    id: 'fantasy-castle',
    title: 'Fantasy Castle Courtyard',
    description: 'Vibrant magical courtyard with floating lanterns and a crystal castle in the distance.',
    tags: ['fantasy', 'magic', 'vibrant'],
    previewUrl: 'https://cdn.daygen.ai/scenes/fantasy-castle-preview.jpg',
    baseImageUrl: 'https://cdn.daygen.ai/scenes/fantasy-castle-base.png',
    baseImageMimeType: 'image/png',
    prompt:
      'Colorful fantasy courtyard at dusk, glowing lanterns and a crystal castle beyond. Insert the referenced person as the central character wearing flowing garments matching the palette.',
    aspectRatio: '4x5',
    renderingSpeed: 'DEFAULT',
    stylePreset: 'MIXED_MEDIA',
  },
  {
    id: 'preset-black-suit-studio',
    styleOptionId: 'female-lifestyle-black-suit-studio',
    title: 'Black Suit Studio',
    description: 'Professional studio portrait session with sharp lighting and tailored attire.',
    tags: ['fashion', 'studio', 'editorial'],
    previewUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/black_suit_studio%20setup.png',
    baseImageUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/black_suit_studio%20setup.png',
    baseImageMimeType: 'image/png',
    baseImageFileName: 'black-suit-studio.png',
    prompt:
      'Professional studio photography setup with confident posture, structured black suit, and controlled lighting. Insert the referenced person as the subject, matching the dramatic tones and camera angle.',
    aspectRatio: '4x5',
    renderingSpeed: 'TURBO',
  styleType: 'REALISTIC',
  },
  {
    id: 'preset-french-balcony',
    styleOptionId: 'female-lifestyle-french-balcony',
    title: 'French Balcony',
    description: 'Romantic Parisian balcony scene overlooking a bustling street.',
    tags: ['travel', 'romance', 'city'],
    previewUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/french_balcony.png',
    baseImageUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/french_balcony.png',
    baseImageMimeType: 'image/png',
    baseImageFileName: 'french-balcony.png',
    prompt:
      'Elegant French balcony setting with warm daylight, wrought iron rails, and charming city energy. Insert the referenced person enjoying the view, matching the relaxed yet stylish mood.',
    aspectRatio: '4x5',
    renderingSpeed: 'DEFAULT',
  styleType: 'REALISTIC',
  },
  {
    id: 'preset-boat-coastal-town',
    styleOptionId: 'female-lifestyle-boat-coastal-town',
    title: 'Boat in Coastal Town',
    description: 'Golden hour portrait aboard a boat in a Mediterranean harbor.',
    tags: ['travel', 'summer', 'lifestyle'],
    previewUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/boat_in_coastal_town.png',
    baseImageUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/boat_in_coastal_town.png',
    baseImageMimeType: 'image/png',
    baseImageFileName: 'boat-coastal-town.png',
    prompt:
      'Charming coastal town setting with glistening water, pastel buildings, and golden hour light. Insert the referenced person relaxing on the boat, matching the sunlit palette and cinematic framing.',
    aspectRatio: '16x9',
    renderingSpeed: 'DEFAULT',
  styleType: 'REALISTIC',
  },
  {
    id: 'preset-brick-in-the-wall',
    styleOptionId: 'female-lifestyle-brick-wall',
    title: 'Brick in the Wall',
    description: 'Urban street portrait against a textured brick backdrop.',
    tags: ['urban', 'street', 'editorial'],
    previewUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/brick_in_the_wall.png',
    baseImageUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/brick_in_the_wall.png',
    baseImageMimeType: 'image/png',
    baseImageFileName: 'brick-in-the-wall.png',
    prompt:
      'Urban street photography with exposed brick, industrial lines, and contemporary fashion. Insert the referenced person as the focal subject, matching the moody lighting and confident pose.',
    aspectRatio: '4x5',
    renderingSpeed: 'DEFAULT',
  styleType: 'REALISTIC',
  },
  {
    id: 'preset-smoking-hot',
    styleOptionId: 'female-lifestyle-smoking-hot',
    title: 'Smoking Hot',
    description: 'Dramatic close-up portrait with warm cinematic lighting.',
    tags: ['editorial', 'dramatic', 'portrait'],
    previewUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/smoking_hot.png',
    baseImageUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/smoking_hot.png',
    baseImageMimeType: 'image/png',
    baseImageFileName: 'smoking-hot.png',
    prompt:
      'Dramatic lifestyle portrait with warm backlight, cinematic haze, and expressive pose. Insert the referenced person as the protagonist, matching the intense mood and color palette.',
    aspectRatio: '4x5',
    renderingSpeed: 'TURBO',
  styleType: 'REALISTIC',
  },
  {
    id: 'preset-sun-and-sea',
    styleOptionId: 'female-lifestyle-sun-and-sea',
    title: 'Sun and Sea',
    description: 'Bright beachside portrait with sparkling water and sun-kissed tones.',
    tags: ['summer', 'beach', 'lifestyle'],
    previewUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/sun_and_sea.png',
    baseImageUrl: 'https://pub-82eeb6c8781b41e6ad18622c727f1cfc.r2.dev/website-assets/presets/sun_and_sea.png',
    baseImageMimeType: 'image/png',
    baseImageFileName: 'sun-and-sea.png',
    prompt:
      'Sun-drenched beach scene with glittering water and relaxed summer styling. Insert the referenced person front and center, harmonizing with the bright, playful atmosphere.',
    aspectRatio: '4x5',
    renderingSpeed: 'DEFAULT',
  styleType: 'REALISTIC',
  },
] as const;

const TEMPLATE_MAP = new Map(SCENE_TEMPLATES.map((template) => [template.id, template]));
const TEMPLATE_BY_STYLE_ID = new Map(
  SCENE_TEMPLATES.filter((template) => template.styleOptionId).map((template) => [template.styleOptionId!, template]),
);

export const getSceneTemplateById = (id: string): SceneTemplate | undefined => TEMPLATE_MAP.get(id);

export const getSceneTemplateByStyleId = (styleId: string): SceneTemplate | undefined =>
  TEMPLATE_BY_STYLE_ID.get(styleId);

export const listPublicSceneTemplates = (): PublicSceneTemplate[] =>
  SCENE_TEMPLATES.map(({ id, title, description, tags, previewUrl, aspectRatio, styleOptionId }) => ({
    id,
    title,
    description,
    tags,
    previewUrl,
    aspectRatio,
    styleOptionId,
  }));

