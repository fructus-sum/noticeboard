<script setup>
// client/admin/src/components/ui/WeeklyTimesEditor.vue — a start time, an end time and the days of the week
//
// v-model: an object with startTime, endTime ('HH:MM') and days (0 Sunday … 6 Saturday, kept
// sorted; without a days list every day counts), edited in place. The same rule on the Server:
// utils/weeklyTimes (SYSTEM_DESIGN §18.3).
//
// Props: daysLabel (the days' label, "Active days" by default)
// Used by: slideshow/ScheduleEditor (a timed slideshow), audio/AudioEventCard (a repeating event)
const times = defineModel({ type: Object, required: true });
defineProps({ daysLabel: { type: String, default: 'Active days' } });

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

function setDay(i, on) {
  const days = [...(times.value.days ?? ALL_DAYS)];
  if (on) { if (!days.includes(i)) days.push(i); }
  else { const idx = days.indexOf(i); if (idx !== -1) days.splice(idx, 1); }
  times.value.days = days.sort((a, b) => a - b);
}
</script>

<template>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
    <div class="field">
      <label>Start time</label>
      <input v-model="times.startTime" type="time" />
    </div>
    <div class="field">
      <label>End time</label>
      <input v-model="times.endTime" type="time" />
    </div>
    <div class="field" style="grid-column:1/-1">
      <label>{{ daysLabel }}</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px">
        <label v-for="(day, i) in DAYS" :key="i"
          style="display:flex;align-items:center;gap:4px;font-weight:400;color:var(--text);font-size:13px">
          <input
            type="checkbox"
            style="width:auto"
            :value="i"
            :checked="(times.days ?? ALL_DAYS).includes(i)"
            @change="setDay(i, $event.target.checked)"
          />{{ day }}
        </label>
      </div>
    </div>
  </div>
</template>
