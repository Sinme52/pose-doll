// Tool-neutral prompts for image generators other than GPT Image (no "IMAGE 1 / IMAGE 2" wording).
const BG = { transparent: 'transparent (or plain white) background, no ground, no cast shadow', opaque: 'plain light background', auto: 'simple background' };

/**
 * description: the pose description from describePose (picture-left/right terms).
 * Returns { referencePrompt, textPrompt, negativePrompt }.
 *  - referencePrompt: for tools that take a character image + a pose image (Gemini / Nano Banana,
 *    Flux Kontext, Seedream, Midjourney --cref + image prompt, ...)
 *  - textPrompt: for text-to-image with ControlNet (OpenPose / Depth) doing the pose
 *  - negativePrompt: for tools that accept one (Stable Diffusion family)
 */
export function genericPrompts({ description, intent = '', hasProps = false, background = 'transparent', extra = '', style = 'color', character = '' }) {
  const who = character || 'the character from the character reference image';
  const colorNote = style === 'color'
    ? ' On the mannequin, BLUE limbs are the character\'s own LEFT arm and leg and RED limbs are the own RIGHT arm and leg.' : '';
  const propNote = hasProps
    ? ' Grey objects on the mannequin (orange marker = muzzle, blade tip or shield front) only stand in for the items the character holds: follow how and where they are held, but draw the character\'s real items.' : '';
  const referencePrompt = [
    `Draw ${who} in exactly the pose of the pose reference image, seen from the same camera angle, at the same size and position in the picture.`,
    `The pose reference is a featureless jointed mannequin: take only the pose, the limb positions and the camera angle from it, not its colors, joints, surface or proportions.${colorNote}${propNote}`,
    'Keep the character exactly as in the character reference: face, hair, outfit, colors, body proportions, equipment and art style.',
    `Pose details (picture-left / picture-right mean the left and right edges of the image): ${description}`,
    extra ? extra.trim() : '',
    `Single full-body character, ${BG[background] || BG.transparent}, no text, no frame, no mannequin.`,
  ].filter(Boolean).join('\n');
  const textPrompt = [
    character || '(describe your character here: face, hair, outfit, colors, equipment, art style)',
    intent ? intent.replace(/[.\s]+$/, '') : '',
    'single full-body character, same proportions as the pose guide',
    BG[background] || BG.transparent,
    extra ? extra.trim().replace(/[.\s]+$/, '') : '',
  ].filter(Boolean).join(', ');
  const negativePrompt = 'extra limbs, extra legs, extra arms, missing limbs, fused legs, duplicated legs, mannequin, wooden doll, '
    + 'ball joints, blue and red limbs, text, watermark, frame, multiple characters, cropped feet, cut-off head';
  return { referencePrompt, textPrompt, negativePrompt };
}

/** One text file holding all prompts, with short instructions. */
export function promptFile(p, files) {
  return [
    '# Prompts for image generators other than GPT Image',
    '',
    '## 1. Tools that take a character image + a pose image',
    `Inputs: your character image, then the pose reference ${files.mannequin}.`,
    '',
    p.referencePrompt,
    '',
    '## 2. Text-to-image with ControlNet (Stable Diffusion / ComfyUI)',
    `ControlNet OpenPose: ${files.openpose} (keypoints: ${files.keypoints})${files.depth ? `   ControlNet Depth: ${files.depth}` : ''}`,
    'Prompt:',
    p.textPrompt,
    '',
    'Negative prompt:',
    p.negativePrompt,
    '',
  ].join('\n');
}
