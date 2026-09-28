<script setup>
// client/admin/src/components/slideshow/ScheduleEditor.vue — when a slideshow is on: always, or
// timed (start and end time, and the days of the week)
//
// v-model: the schedule, { type: 'always' } or { type: 'timed', startTime, endTime, days? },
// edited in place. Days are 0 (Sunday) to 6, kept sorted; without a days list every day counts.
// Two form fields side by side in the parent's form (no wrapper element).
//
// Used by: SlideshowSettingsCard
// Uses: ui/WeeklyTimesEditor (the times and days, shared with event audio)
import WeeklyTimesEditor from '../ui/WeeklyTimesEditor.vue';

const schedule = defineModel({ type: Object, required: true });
</script>

<template>
  <div class="field">
    <label>Schedule</label>
    <select v-model="schedule.type">
      <option value="always">Always active</option>
      <option value="timed">Timed</option>
    </select>
  </div>
  <WeeklyTimesEditor v-if="schedule.type === 'timed'" v-model="schedule" />
</template>
