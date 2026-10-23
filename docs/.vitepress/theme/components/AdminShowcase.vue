<script setup>
import { ref } from 'vue'
import { withBase } from 'vitepress'

const slides = [
  {
    key: 'versions', label: 'Version adoption', eyebrow: '01 / Understand adoption',
    title: 'Know which versions still need support.',
    description: 'Compare active installations by app version, runtime, channel and platform. See exactly where your next update needs to go.',
    path: '/updates/devices', file: 'admin-versions.jpg',
    alt: 'Dark admin dashboard with 6,240 simulated active installations and a version adoption bar chart for the production Android channel.',
  },
  {
    key: 'cohorts', label: 'Activity & cohorts', eyebrow: '02 / Follow your users',
    title: 'Turn installation heartbeats into a clear picture.',
    description: 'Explore daily activity and weekly cohorts. Separate devices running an OTA from those still on the embedded build.',
    path: '/updates/devices', file: 'admin-cohorts.jpg',
    alt: 'Installation activity chart and weekly adoption cohorts, with simulated OTA and embedded-build distribution.',
  },
  {
    key: 'updates', label: 'Release management', eyebrow: '03 / Manage releases',
    title: 'A single view of what is ready and what is live.',
    description: 'Review Android and iOS updates together, inspect their delivery status, and keep publication separate from activation.',
    path: '/updates', file: 'admin-updates.jpg',
    alt: 'OTA release list with synthetic Android and iOS versions, active releases and drafts restricted to selected devices.',
  },
  {
    key: 'targeting', label: 'Device targeting', eyebrow: '04 / Start with your devices',
    title: 'Smoke-test first. Expand the audience when ready.',
    description: 'Choose named devices for a release, test the update, then make it available to all compatible installations.',
    path: '/updates/…', file: 'admin-targeting.jpg',
    alt: 'Update audience editor with two simulated QA phones selected and background delivery options below.',
  },
]
const active = ref(0)
const tabs = ref([])
function select(index, focus = false) {
  active.value = (index + slides.length) % slides.length
  if (focus) tabs.value[active.value]?.focus()
}
function onKeydown(event) {
  const keys = { ArrowRight: active.value + 1, ArrowLeft: active.value - 1, Home: 0, End: slides.length - 1 }
  if (!(event.key in keys)) return
  event.preventDefault()
  select(keys[event.key], true)
}
</script>

<template>
  <section class="admin-showcase" aria-label="Admin panel preview">
    <div class="showcase-tabs" role="tablist" aria-label="Explore the admin panel" @keydown="onKeydown">
      <button v-for="(slide, index) in slides" :key="slide.key" :ref="el => tabs[index] = el"
        :id="`preview-tab-${slide.key}`" class="showcase-tab" role="tab" type="button"
        :aria-selected="active === index" :aria-controls="`preview-panel-${slide.key}`"
        :tabindex="active === index ? 0 : -1" @click="select(index)">
        <span class="tab-number" aria-hidden="true">0{{ index + 1 }}</span>{{ slide.label }}
      </button>
    </div>

    <div class="showcase-frame">
      <div class="showcase-toolbar">
        <div class="showcase-location"><span class="preview-dot" aria-hidden="true"></span><span>OTA Console</span><span class="preview-path">{{ slides[active].path }}</span></div>
        <div class="showcase-controls">
          <span class="demo-label">Demo data</span>
          <button type="button" aria-label="Previous admin screenshot" @click="select(active - 1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m14 6-6 6 6 6" /></svg>
          </button>
          <button type="button" aria-label="Next admin screenshot" @click="select(active + 1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" aria-hidden="true"><path d="m10 6 6 6-6 6" /></svg>
          </button>
        </div>
      </div>
      <figure v-for="(slide, index) in slides" v-show="active === index" :key="slide.key"
        :id="`preview-panel-${slide.key}`" class="showcase-panel" role="tabpanel" :aria-labelledby="`preview-tab-${slide.key}`">
        <a :href="withBase(`/screenshots/${slide.file}`)" target="_blank" rel="noopener"
          :aria-label="`Open full-size screenshot: ${slide.label}`">
          <img :src="withBase(`/screenshots/${slide.file}`)" :alt="slide.alt" width="2520" height="1800"
            :loading="index === 0 ? 'eager' : 'lazy'" :fetchpriority="index === 0 ? 'high' : 'auto'" />
          <span class="expand-hint" aria-hidden="true">View full size ↗</span>
        </a>
      </figure>
    </div>

    <div class="showcase-caption" aria-live="polite" aria-atomic="true">
      <div><p class="showcase-eyebrow">{{ slides[active].eyebrow }}</p><h2>{{ slides[active].title }}</h2></div>
      <p class="showcase-description">{{ slides[active].description }}</p>
    </div>
    <p class="showcase-note">Real admin interface. Illustrative versions, devices and activity.</p>
  </section>
</template>

<style scoped>
.admin-showcase { max-width: 1216px; margin: 0 auto 88px; padding: 0 32px; }
.showcase-tabs { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 0 0 18px; }
.showcase-tab { display: flex; justify-content: center; align-items: center; gap: 10px; min-height: 48px; padding: 10px 12px; border: 1px solid var(--vp-c-divider); border-radius: 10px; background: var(--vp-c-bg-soft); color: var(--vp-c-text-2); font-size: 13px; font-weight: 600; cursor: pointer; transition: border-color .15s, background .15s; }
.showcase-tab:hover { border-color: var(--vp-c-brand-1); color: var(--vp-c-text-1); }
.showcase-tab[aria-selected="true"] { color: var(--vp-c-brand-1); border-color: var(--vp-c-brand-1); background: var(--vp-c-brand-soft); }
.tab-number { font-size: 11px; font-weight: 500; opacity: .75; font-variant-numeric: tabular-nums; }
.showcase-frame { overflow: hidden; border: 1px solid #353b49; border-radius: 16px; background: #11151d; box-shadow: 0 28px 80px -30px rgb(29 24 87 / 35%); }
.showcase-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px 10px 20px; border-bottom: 1px solid #303643; color: #dce1eb; font-size: 12px; background: #191e28; }
.showcase-location, .showcase-controls { display: flex; align-items: center; gap: 12px; }
.showcase-location { min-width: 0; }
.preview-dot { flex-shrink: 0; height: 7px; width: 7px; border-radius: 50%; background: #a79bfa; box-shadow: 0 0 12px #a79bfa40; }
.preview-path { color: #949fb2; font-size: 11px; font-family: var(--vp-font-family-mono); }
.demo-label { color: #c0c8d8; white-space: nowrap; font-size: 11px; margin-right: 4px; }
.showcase-controls button { display: grid; place-items: center; width: 36px; height: 36px; border: 1px solid #3d4657; border-radius: 8px; color: #e2e8f0; cursor: pointer; background: #242b38; }
.showcase-controls button:hover { background: #384254; }
.showcase-controls svg { height: 18px; width: 18px; }
.showcase-panel { margin: 0; }
.showcase-panel a { position: relative; display: block; }
.showcase-panel img { display: block; width: 100%; height: auto; aspect-ratio: 1680 / 1200; }
.expand-hint { position: absolute; bottom: 18px; right: 18px; padding: 8px 12px; border: 1px solid #526078; border-radius: 8px; color: #f1f5ff; background: #1b2333ed; font-size: 11px; opacity: 0; transition: opacity .15s; }
.showcase-panel a:hover .expand-hint, .showcase-panel a:focus-visible .expand-hint { opacity: 1; }
.showcase-caption { display: grid; grid-template-columns: 1.1fr 1fr; gap: 36px; align-items: start; padding: 28px 4px 0; min-height: 130px; }
.showcase-eyebrow { margin: 0 0 8px; color: var(--vp-c-brand-1); font-size: 11px; font-weight: 650; letter-spacing: .1em; text-transform: uppercase; }
.showcase-caption h2 { margin: 0; border: 0; font-size: 22px; line-height: 1.4; letter-spacing: -.025em; font-weight: 650; color: var(--vp-c-text-1); }
.showcase-description { margin: 0; font-size: 14px; line-height: 1.8; color: var(--vp-c-text-2); }
.showcase-note { margin: 14px 4px 0; font-size: 11px; color: var(--vp-c-text-2); }
button:focus-visible, a:focus-visible { outline: 3px solid var(--vp-c-brand-1); outline-offset: 4px; }
@media (max-width: 767px) {
  .admin-showcase { padding: 0 24px; margin-bottom: 56px; }
  .showcase-tabs { grid-template-columns: repeat(2, 1fr); gap: 8px; }
  .showcase-tab { font-size: 12px; gap: 7px; padding: 9px 5px; }
  .showcase-toolbar { padding: 8px 10px; }
  .showcase-location { font-size: 11px; gap: 8px; }
  .preview-path { display: none; }
  .showcase-controls { gap: 7px; }
  .showcase-controls button { width: 40px; height: 40px; }
  .showcase-frame { border-radius: 11px; }
  .showcase-caption { grid-template-columns: 1fr; gap: 12px; padding-top: 22px; min-height: 190px; }
  .showcase-caption h2 { font-size: 20px; }
  .showcase-description { font-size: 13px; }
  .expand-hint { opacity: 1; bottom: 8px; right: 8px; padding: 4px 7px; font-size: 9px; }
}
@media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
</style>
