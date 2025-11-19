THIS IS CRITICAL FILE! DO NOT TOUCH IT!!!


Stripe webhook: 2025-09-30

Quick notes:
Style progress bar on the image
Clean unneaded code from payments
Highlight current subscription

Make loading ring to be continous progress not discrete

Make image generation faster



## Step-by-step explanation

### Overview
The feature lets users select style presets, upload a photo, and generate images that blend their photo with each selected preset using Ideogram's Remix API.

---

### Step 1: User clicks "Style" button

Location: `PromptForm.tsx`

- Clicking "Style" opens `StyleSelectionModal`.
- The modal shows style options organized by gender (Male/Female/All) and category (Lifestyle/Formal/Artistic).

---

### Step 2: User selects style presets

Location: `StyleSelectionModal.tsx` + `useStyleHandlers.ts`

- Users can select multiple styles.
- Selections are stored in `tempSelectedStyles` (temporary state).
- Each `StyleOption` has:
  - `id` (e.g., `"unisex-lifestyle-black-suit-studio"`)
  - `name` (e.g., `"Black Suit Studio"`)
  - `prompt` (style description)
  - `image` (preview image URL)

---

### Step 3: User clicks "Apply"

Location: `StyleSelectionModal.tsx` (line 78-83)

```typescript
const handleApply = useCallback(() => {
  const applied = handleApplyStyles(); // Returns selected styles
  if (applied?.length && onApplySelectedStyles) {
    onApplySelectedStyles(applied); // Passes to parent
  }
}, [handleApplyStyles, onApplySelectedStyles]);
```

- `handleApplyStyles()` finalizes selections and returns the list of selected `StyleOption[]`.
- `onApplySelectedStyles(applied)` passes them to `PromptForm`.

---

### Step 4: PromptForm receives selected styles

Location: `PromptForm.tsx` (line 134-139)

```typescript
const handlePresetStylesApply = useCallback(
  (appliedStyles: StyleOption[]) => {
    presetGenerationFlow.openForStyles(appliedStyles);
  },
  [presetGenerationFlow],
);
```

- `handlePresetStylesApply` receives the selected styles.
- Calls `presetGenerationFlow.openForStyles(appliedStyles)` to initialize the preset generation flow.

---

### Step 5: Preset generation modal opens

Location: `usePresetGenerationFlow.ts` (line 55-69)

```typescript
const openForStyles = useCallback((styles: StyleOption[]) => {
  if (!styles.length) { return; }
  const nextJobs = styles.map<PresetGenerationJob>((style) => ({
    style,
    status: 'pending',
  }));
  setJobs(nextJobs); // One job per selected style
  setIsOpen(true);
  setStep('upload');
  // ...
}, []);
```

- Creates one `PresetGenerationJob` per selected style.
- Each job has:
  - `style`: The `StyleOption`
  - `status`: `'pending'` → `'running'` → `'succeeded'` or `'failed'`
  - `response`: Generated image data (later)
- Modal opens in the `'upload'` step.

---

### Step 6: User uploads character photo

Location: `PresetGenerationModal.tsx` (line 76-111)

- Modal shows:
  - Selected styles (as cards with previews)
  - Upload area (drag & drop or file picker)
- When a file is selected:
  - `handleFileSelect` validates (image type, max 12MB)
  - Creates a preview using `URL.createObjectURL`
  - Stores the `File` object in state

---

### Step 7: User clicks "Generate presets"

Location: `usePresetGenerationFlow.ts` (line 116-170)

```typescript
const startGeneration = useCallback(async () => {
  // Validation...
  setIsGenerating(true);
  setStep('generating');
  
  // Loop through each job
  for (let index = 0; index < jobs.length; index += 1) {
    // Update job status to 'running'
    setJobs((prev) => { /* ... */ });
    
    try {
      // Call API for this style
      const response = await generatePresetImage({
        styleOptionId: jobs[index].style.id, // e.g., "unisex-lifestyle-black-suit-studio"
        characterImage: uploadFile,
      });
      
      // Mark as succeeded
      setJobs((prev) => { /* ... */ });
      
      // Add to gallery
      await addImage({
        url: response.imageUrl,
        prompt: response.prompt,
        model: 'ideogram-remix',
        // ...
      });
    } catch (error) {
      // Mark as failed
      setJobs((prev) => { /* ... */ });
    }
  }
  
  setIsGenerating(false);
  setStep('results');
}, [/* ... */]);
```

- Validates file and jobs.
- Sets step to `'generating'`.
- Loops through each job sequentially.
- For each job:
  - Updates status to `'running'`
  - Calls `generatePresetImage` API
  - On success: updates status to `'succeeded'`, stores response, adds to gallery
  - On error: updates status to `'failed'`
- After all jobs complete, sets step to `'results'`.

---

### Step 8: Frontend API call

Location: `presetGeneration.ts` (line 6-52)

```typescript
export async function generatePresetImage(
  payload: PresetGenerationRequest,
  signal?: AbortSignal,
): Promise<PresetGenerationResponse> {
  const formData = new FormData();
  formData.set('styleOptionId', payload.styleOptionId); // e.g., "unisex-lifestyle-black-suit-studio"
  formData.set('characterImage', payload.characterImage); // The uploaded File
  
  const token = await ensureValidToken();
  const response = await fetch(getApiUrl('/api/scene/generate'), {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: formData,
  });
  // ... error handling ...
  return payloadJson as PresetGenerationResponse;
}
```

- Builds `FormData` with `styleOptionId` and `characterImage`.
- Sends POST to `/api/scene/generate` with JWT auth.

---

### Step 9: Backend receives request

Location: `scenes.service.ts` (line 51-128)

```typescript
async generateScene(
  user: SanitizedUser,
  dto: GenerateSceneDto,
  characterImage?: Express.Multer.File,
) {
  // 1. Validate character image
  if (!characterImage || characterImage.size > 12MB) {
    throw new BadRequestException('...');
  }
  
  // 2. Resolve template from styleOptionId
  const template = this.resolveTemplate(dto);
  
  // 3. Check credits
  await this.assertCredits(user);
  
  // 4. Record usage (deduct credit)
  await this.usageService.recordGeneration(user, {
    provider: 'scene-placement',
    model: 'ideogram-remix',
    cost: this.costPerScene, // 1 credit
  });
  
  // 5. Load base scene image
  const baseImage = await this.loadTemplateImage(template);
  
  // 6. Call Ideogram API
  const providerResult = await this.callIdeogramRemix({
    baseImage,
    characterImage,
    prompt: finalPrompt,
    // ...
  });
  
  // 7. Download generated image
  const generatedImage = await this.downloadProviderImage(providerResult.url);
  
  // 8. Upload to R2 storage
  const publicUrl = await this.uploadResultToR2(user, template, finalPrompt, generatedImage);
  
  return {
    success: true,
    imageUrl: publicUrl.fileUrl,
    // ...
  };
}
```

---

### Step 10: Backend resolves template

Location: `scenes.service.ts` (line 145-163) + `scene-templates.ts`

```typescript
private resolveTemplate(dto: GenerateSceneDto): SceneTemplate {
  if (dto.styleOptionId) {
    const template = getSceneTemplateByStyleId(dto.styleOptionId);
    if (!template) {
      throw new BadRequestException(`Unknown style preset: ${dto.styleOptionId}`);
    }
    return template;
  }
  // ... fallback to sceneTemplateId ...
}
```

- Maps `styleOptionId` (e.g., `"unisex-lifestyle-black-suit-studio"`) to a `SceneTemplate`.
- Each template includes:
  - `baseImageUrl`: Scene image URL
  - `prompt`: Instructions for Ideogram
  - `aspectRatio`, `renderingSpeed`, etc.

Example mapping in `scene-templates.ts`:
```typescript
{
  id: 'preset-black-suit-studio',
  styleOptionId: 'unisex-lifestyle-black-suit-studio', // Links to frontend style
  baseImageUrl: 'https://.../black_suit_studio setup.png',
  prompt: 'Professional studio photography setup...',
  // ...
}
```

---

### Step 11: Backend calls Ideogram Remix API

Location: `scenes.service.ts` (line 208-257)

```typescript
private async callIdeogramRemix(params: {
  baseImage: { buffer: Buffer; mimeType: string; fileName: string };
  characterImage: Express.Multer.File;
  prompt: string;
  aspectRatio: string;
  renderingSpeed: string;
  stylePreset: string;
}) {
  const form = new FormData();
  form.set('prompt', params.prompt);
  form.set('aspect_ratio', params.aspectRatio);
  form.set('rendering_speed', params.renderingSpeed);
  
  // Base scene image
  form.set('image', 
    new Blob([params.baseImage.buffer], { type: params.baseImage.mimeType }),
    params.baseImage.fileName
  );
  
  // User's character photo
  form.append('character_reference_images',
    new Blob([params.characterImage.buffer], { type: params.characterImage.mimetype }),
    params.characterImage.originalname
  );
  
  const response = await fetch('https://api.ideogram.ai/v1/ideogram-v3/remix', {
    method: 'POST',
    headers: { 'Api-Key': ideogramApiKey },
    body: form,
  });
  
  // Extract image URL from response
  const urls = this.collectUrls(payload);
  return { url: urls[0], rawResponse: payload };
}
```

- Sends:
  - `image`: Base scene template image
  - `character_reference_images`: User's uploaded photo
  - `prompt`: Instructions for blending
- Ideogram returns a generated image URL.

---

### Step 12: Backend processes result

Location: `scenes.service.ts` (line 302-354)

1. Downloads the generated image from Ideogram.
2. Uploads to Cloudflare R2 storage.
3. Creates a database record in `r2_files`.
4. Returns a public URL to the frontend.

---

### Step 13: Frontend displays results

Location: `PresetGenerationModal.tsx` (line 115-140)

- After all jobs complete, the modal shows the `'results'` step.
- For each job:
  - If succeeded: displays the generated image with download link
  - If failed: shows an error message
- All successful images are already added to the gallery.

---

### Step 14: User can download or close

- Each result has a "Download" link.
- Clicking "Close" closes the modal.
- Generated images remain in the gallery.

---

## Key design decisions

1. One job per style: Multiple selections create multiple jobs, each generating one image.
2. Sequential processing: Jobs run one after another to avoid rate limits and manage credits.
3. Credit system: Each generation costs 1 credit, deducted before the API call; refunded on failure.
4. Template mapping: `styleOptionId` links frontend styles to backend scene templates.
5. State management: `usePresetGenerationFlow` manages the multi-step flow (upload → generating → results).

---

## Data flow summary

```
User selects styles → Apply clicked → Modal opens (upload step)
  ↓
User uploads photo → Generate clicked → Loop through jobs
  ↓
For each job: API call with styleOptionId + characterImage
  ↓
Backend: Resolve template → Call Ideogram → Store in R2 → Return URL
  ↓
Frontend: Update job status → Add to gallery → Show results
```

This enables users to blend their photo with multiple style presets in one workflow.
>>>>>>> origin/main
