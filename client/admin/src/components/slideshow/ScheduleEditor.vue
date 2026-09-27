<script setup>
// client/admin/src/components/slideshow/ScheduleEditor.vue — when a slideshow is on: always, or
// timed (start and end time, and the days of the week)
//
// v-model: the schedule, { type: 'always' } or { type: 'timed', startTime, endTime, days? },
// edited in place. Days are 0 (Sunday) to 6, kept sorted; without a days list every day counts.
// Two form fields side by side in the parent's form (no wrapper element).
//
// Used by: SlideshowSettingsCard
const schedule = defineModel({ type: Object, required: true });

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function setDay(i, on) {
  const days = [...(schedule.value.days ?? ALL_DAYS)];
  if (on) { if (!days.includes(i)) days.push(i); }
  else { const idx = days.indexOf(i); if (idx !== -1) days.splice(idx, 1); }
  schedule.value.days = days.sort((a, b) => a - b);
}
</script>

<template>
  <div class="field">
    <label>Schedule</label>
    <select v-model="schedule.type">
      <option value="always">Always active</option>
      <option value="timed">Timed</option>
    </select>
  </div>
  <div v-if="schedule.type === 'timed'" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
    <div class="field">
      <label>Start time</label>
      <input v-model="schedule.startTime" type="time" />
    </div>
    <div class="field">
      <label>End time</label>
      <input v-model="schedule.endTime" type="time" />
    </div>
    <div class="field" style="grid-column:1/-1">
      <label>Active days</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
        <label v-for="(day, i) in DAYS" :key="i"
          style="display:flex;align-items:center;gap:4px;font-weight:400;color:var(--text);font-size:13px">
          <input
            type="checkbox"
            style="width:auto"
            :value="i"
            :checked="(schedule.days ?? ALL_DAYS).includes(i)"
            @change="setDay(i, $event.target.checked)"
          />{{ day }}
        </label>
      </div>
    </div>
  </div>
</template>
