import type { ParentGoal, WhiteTarget } from './goal-input.ts';
import type { Lineage } from './sparks.ts';

export interface GoalTemplate {
  id: string;
  name: string;
  description?: string;
  goal: ParentGoal;
  targets: WhiteTarget[];
  targetLineage?: Record<string, Lineage>;
}

const GODLY_DESCRIPTION = "dont take this build too seriously, its more just to show the probability of getting a parent with this many spark goals. you could of course make this even crazier with more 3*s and more required white sparks, but at that point it enters the realm being outright impossible.";

/** Curated from docs/spark-goal-templates.md. IDs identify templates independently of their display names. */
export const GOAL_TEMPLATES: readonly GoalTemplate[] = [
  {
    id: 'front-runner-parent-lite', name: 'Front runner parent (lite)',
    goal: { blueStats: ['speed', 'stamina', 'power', 'guts', 'wit'], blueStars: 2, pink: [{ aptitude: 'any', stars: 1 }] },
    targets: [
      { id: 201601, role: 'required', stars: 2, priority: 0 }, // Groundwork
      { id: 200452, role: 'preferred', stars: 2, priority: 0 }, // Prudent Positioning
      { id: 201262, role: 'preferred', stars: 2, priority: 0 }, // Dodging Danger
      { id: 200012, role: 'preferred', stars: 2, priority: 0 }, // Right-Handed
      { id: 200022, role: 'preferred', stars: 2, priority: 0 }, // Left-Handed
      { id: 201611, role: 'preferred', stars: 2, priority: 0 }, // Tail Held High
      { id: 201252, role: 'preferred', stars: 2, priority: 0 }, // Front Runner Corners
      { id: 201242, role: 'preferred', stars: 2, priority: 0 }, // Front Runner Straightaways
      { id: 201522, role: 'preferred', stars: 2, priority: 1 }, // Front Runner Savvy
      { id: 200192, role: 'preferred', stars: 2, priority: 1 }, // Fall Runner
      { id: 200202, role: 'preferred', stars: 2, priority: 1 }, // Winter Runner
      { id: 200172, role: 'preferred', stars: 2, priority: 1 }, // Spring Runner
      { id: 200152, role: 'preferred', stars: 2, priority: 1 }, // Firm Conditions
      { id: 200162, role: 'preferred', stars: 2, priority: 1 }, // Wet Conditions
      { id: 200132, role: 'preferred', stars: 2, priority: 1 }, // Standard Distance
      { id: 200142, role: 'preferred', stars: 2, priority: 1 }, // Non-Standard Distance
    ],
  },
  {
    id: 'front-runner-parent-decent', name: 'Front runner parent (decent)',
    goal: { blueStats: ['speed', 'stamina', 'power', 'wit'], blueStars: 2, pink: [{ aptitude: 'any', stars: 2 }] },
    targets: [
      { id: 201601, role: 'required', stars: 2, priority: 0 }, // Groundwork
      { id: 210052, role: 'required', stars: 2, priority: 0 }, // Ignited Spirit WIT
      { id: 200452, role: 'preferred', stars: 2, priority: 0 }, // Prudent Positioning
      { id: 201262, role: 'preferred', stars: 2, priority: 0 }, // Dodging Danger
      { id: 200012, role: 'preferred', stars: 2, priority: 0 }, // Right-Handed
      { id: 200022, role: 'preferred', stars: 2, priority: 0 }, // Left-Handed
      { id: 201611, role: 'preferred', stars: 2, priority: 0 }, // Tail Held High
      { id: 202462, role: 'preferred', stars: 2, priority: 0 }, // Firm Resolve
      { id: 201252, role: 'preferred', stars: 2, priority: 0 }, // Front Runner Corners
      { id: 201242, role: 'preferred', stars: 2, priority: 0 }, // Front Runner Straightaways
      { id: 201522, role: 'preferred', stars: 2, priority: 1 }, // Front Runner Savvy
      { id: 200192, role: 'preferred', stars: 2, priority: 1 }, // Fall Runner
      { id: 200202, role: 'preferred', stars: 2, priority: 1 }, // Winter Runner
      { id: 200172, role: 'preferred', stars: 2, priority: 1 }, // Spring Runner
      { id: 200152, role: 'preferred', stars: 2, priority: 1 }, // Firm Conditions
      { id: 200162, role: 'preferred', stars: 2, priority: 1 }, // Wet Conditions
      { id: 200132, role: 'preferred', stars: 2, priority: 1 }, // Standard Distance
      { id: 200142, role: 'preferred', stars: 2, priority: 1 }, // Non-Standard Distance
    ],
  },
  {
    id: 'front-runner-parent-godly', name: 'Front runner parent (godly)',
    description: GODLY_DESCRIPTION,
    goal: { blueStats: ['speed', 'stamina', 'power'], blueStars: 3, pink: [{ aptitude: 'any', stars: 2 }] },
    targetLineage: {
      201601: { k1: 3, p1: 7, k2: 3, p2: 7 },
      210052: { k1: 3, p1: 7, k2: 3, p2: 7 },
      210101: { k1: 3, p1: 7, k2: 3, p2: 7 },
      200452: { k1: 3, p1: 7, k2: 3, p2: 7 },
      201262: { k1: 3, p1: 7, k2: 3, p2: 7 },
      201611: { k1: 3, p1: 7, k2: 3, p2: 7 },
      202462: { k1: 3, p1: 7, k2: 3, p2: 7 },
    },
    targets: [
      { id: 201601, role: 'required', stars: 2, priority: 0 }, // Groundwork
      { id: 210052, role: 'required', stars: 2, priority: 0 }, // Ignited Spirit WIT
      { id: 210101, role: 'required', stars: 2, priority: 0 }, // Racing Spirit: Stamina
      { id: 200452, role: 'required', stars: 2, priority: 0 }, // Prudent Positioning
      { id: 201262, role: 'required', stars: 2, priority: 0 }, // Dodging Danger
      { id: 201611, role: 'required', stars: 2, priority: 0 }, // Tail Held High
      { id: 202462, role: 'required', stars: 2, priority: 0 }, // Firm Resolve
      { id: 200012, role: 'preferred', stars: 2, priority: 0 }, // Right-Handed
      { id: 200022, role: 'preferred', stars: 2, priority: 0 }, // Left-Handed
      { id: 201252, role: 'preferred', stars: 2, priority: 0 }, // Front Runner Corners
      { id: 201242, role: 'preferred', stars: 2, priority: 0 }, // Front Runner Straightaways
      { id: 201522, role: 'preferred', stars: 2, priority: 1 }, // Front Runner Savvy
      { id: 200192, role: 'preferred', stars: 2, priority: 1 }, // Fall Runner
      { id: 200202, role: 'preferred', stars: 2, priority: 1 }, // Winter Runner
      { id: 200172, role: 'preferred', stars: 2, priority: 1 }, // Spring Runner
      { id: 200152, role: 'preferred', stars: 2, priority: 1 }, // Firm Conditions
      { id: 200162, role: 'preferred', stars: 2, priority: 1 }, // Wet Conditions
      { id: 200132, role: 'preferred', stars: 2, priority: 1 }, // Standard Distance
      { id: 200142, role: 'preferred', stars: 2, priority: 1 }, // Non-Standard Distance
    ],
  },
  {
    id: 'pace-chaser-parent-lite', name: 'Pace chaser parent (lite)',
    goal: { blueStats: ['speed', 'stamina', 'power', 'guts', 'wit'], blueStars: 2, pink: [{ aptitude: 'any', stars: 1 }] },
    targets: [
      { id: 200492, role: 'required', stars: 2, priority: 0 }, // Nimble Navigator
      { id: 201601, role: 'preferred', stars: 2, priority: 0 }, // Groundwork
      { id: 201591, role: 'preferred', stars: 2, priority: 0 }, // Uma Stan
      { id: 201611, role: 'preferred', stars: 2, priority: 0 }, // Tail Held High
      { id: 201332, role: 'preferred', stars: 2, priority: 0 }, // Shrewd Step
      { id: 200012, role: 'preferred', stars: 2, priority: 0 }, // Right-Handed
      { id: 200022, role: 'preferred', stars: 2, priority: 0 }, // Left-Handed
      { id: 200462, role: 'preferred', stars: 2, priority: 0 }, // Ramp Up
      { id: 201661, role: 'preferred', stars: 2, priority: 0 }, // Playtime's Over!
      { id: 201651, role: 'preferred', stars: 2, priority: 0 }, // Slipstream
      { id: 201322, role: 'preferred', stars: 2, priority: 0 }, // Pace Chaser Corners
      { id: 201312, role: 'preferred', stars: 2, priority: 0 }, // Pace Chaser Straightaways
      { id: 201532, role: 'preferred', stars: 2, priority: 1 }, // Pace Chaser Savvy
      { id: 200192, role: 'preferred', stars: 2, priority: 1 }, // Fall Runner
      { id: 200202, role: 'preferred', stars: 2, priority: 1 }, // Winter Runner
      { id: 200172, role: 'preferred', stars: 2, priority: 1 }, // Spring Runner
      { id: 200152, role: 'preferred', stars: 2, priority: 1 }, // Firm Conditions
      { id: 200162, role: 'preferred', stars: 2, priority: 1 }, // Wet Conditions
      { id: 200132, role: 'preferred', stars: 2, priority: 1 }, // Standard Distance
      { id: 200142, role: 'preferred', stars: 2, priority: 1 }, // Non-Standard Distance
    ],
  },
  {
    id: 'pace-chaser-parent-decent', name: 'Pace chaser parent (decent)',
    goal: { blueStats: ['speed', 'stamina', 'power', 'wit'], blueStars: 2, pink: [{ aptitude: 'any', stars: 2 }] },
    targets: [
      { id: 201601, role: 'required', stars: 2, priority: 0 }, // Groundwork
      { id: 200492, role: 'required', stars: 2, priority: 0 }, // Nimble Navigator
      { id: 210101, role: 'preferred', stars: 2, priority: 0 }, // Racing Spirit: Stamina
      { id: 210111, role: 'preferred', stars: 2, priority: 0 }, // Racing Spirit: Power
      { id: 201591, role: 'preferred', stars: 2, priority: 0 }, // Uma Stan
      { id: 201611, role: 'preferred', stars: 2, priority: 0 }, // Tail Held High
      { id: 201332, role: 'preferred', stars: 2, priority: 0 }, // Shrewd Step
      { id: 200012, role: 'preferred', stars: 2, priority: 0 }, // Right-Handed
      { id: 200022, role: 'preferred', stars: 2, priority: 0 }, // Left-Handed
      { id: 200462, role: 'preferred', stars: 2, priority: 0 }, // Ramp Up
      { id: 201661, role: 'preferred', stars: 2, priority: 0 }, // Playtime's Over!
      { id: 201651, role: 'preferred', stars: 2, priority: 0 }, // Slipstream
      { id: 201322, role: 'preferred', stars: 2, priority: 0 }, // Pace Chaser Corners
      { id: 201312, role: 'preferred', stars: 2, priority: 0 }, // Pace Chaser Straightaways
      { id: 201532, role: 'preferred', stars: 2, priority: 1 }, // Pace Chaser Savvy
      { id: 200192, role: 'preferred', stars: 2, priority: 1 }, // Fall Runner
      { id: 200202, role: 'preferred', stars: 2, priority: 1 }, // Winter Runner
      { id: 200172, role: 'preferred', stars: 2, priority: 1 }, // Spring Runner
      { id: 200152, role: 'preferred', stars: 2, priority: 1 }, // Firm Conditions
      { id: 200162, role: 'preferred', stars: 2, priority: 1 }, // Wet Conditions
      { id: 200132, role: 'preferred', stars: 2, priority: 1 }, // Standard Distance
      { id: 200142, role: 'preferred', stars: 2, priority: 1 }, // Non-Standard Distance
    ],
  },
  {
    id: 'pace-chaser-parent-godly', name: 'Pace chaser parent (godly)',
    description: GODLY_DESCRIPTION,
    goal: { blueStats: ['speed', 'stamina', 'power'], blueStars: 3, pink: [{ aptitude: 'any', stars: 2 }] },
    targetLineage: {
      201601: { k1: 3, p1: 7, k2: 3, p2: 7 },
      200492: { k1: 3, p1: 7, k2: 3, p2: 7 },
      210101: { k1: 3, p1: 7, k2: 3, p2: 7 },
      210111: { k1: 3, p1: 7, k2: 3, p2: 7 },
      201591: { k1: 3, p1: 7, k2: 3, p2: 7 },
      201611: { k1: 3, p1: 7, k2: 3, p2: 7 },
      201332: { k1: 3, p1: 7, k2: 3, p2: 7 },
    },
    targets: [
      { id: 201601, role: 'required', stars: 2, priority: 0 }, // Groundwork
      { id: 200492, role: 'required', stars: 2, priority: 0 }, // Nimble Navigator
      { id: 210101, role: 'required', stars: 2, priority: 0 }, // Racing Spirit: Stamina
      { id: 210111, role: 'required', stars: 2, priority: 0 }, // Racing Spirit: Power
      { id: 201591, role: 'required', stars: 2, priority: 0 }, // Uma Stan
      { id: 201611, role: 'required', stars: 2, priority: 0 }, // Tail Held High
      { id: 201332, role: 'required', stars: 2, priority: 0 }, // Shrewd Step
      { id: 200012, role: 'preferred', stars: 2, priority: 0 }, // Right-Handed
      { id: 200022, role: 'preferred', stars: 2, priority: 0 }, // Left-Handed
      { id: 200462, role: 'preferred', stars: 2, priority: 0 }, // Ramp Up
      { id: 201661, role: 'preferred', stars: 2, priority: 0 }, // Playtime's Over!
      { id: 201651, role: 'preferred', stars: 2, priority: 0 }, // Slipstream
      { id: 201322, role: 'preferred', stars: 2, priority: 0 }, // Pace Chaser Corners
      { id: 201312, role: 'preferred', stars: 2, priority: 0 }, // Pace Chaser Straightaways
      { id: 201532, role: 'preferred', stars: 2, priority: 1 }, // Pace Chaser Savvy
      { id: 200192, role: 'preferred', stars: 2, priority: 1 }, // Fall Runner
      { id: 200202, role: 'preferred', stars: 2, priority: 1 }, // Winter Runner
      { id: 200172, role: 'preferred', stars: 2, priority: 1 }, // Spring Runner
      { id: 200152, role: 'preferred', stars: 2, priority: 1 }, // Firm Conditions
      { id: 200162, role: 'preferred', stars: 2, priority: 1 }, // Wet Conditions
      { id: 200132, role: 'preferred', stars: 2, priority: 1 }, // Standard Distance
      { id: 200142, role: 'preferred', stars: 2, priority: 1 }, // Non-Standard Distance
    ],
  },
  {
    id: 'late-surger-parent-lite', name: 'Late surger parent (lite)',
    goal: { blueStats: ['speed', 'stamina', 'power', 'guts', 'wit'], blueStars: 2, pink: [{ aptitude: 'any', stars: 1 }] },
    targets: [
      { id: 201591, role: 'required', stars: 2, priority: 0 }, // Uma Stan
      { id: 201611, role: 'preferred', stars: 2, priority: 0 }, // Tail Held High
      { id: 200492, role: 'preferred', stars: 2, priority: 0 }, // Nimble Navigator
      { id: 201392, role: 'preferred', stars: 2, priority: 0 }, // Late Surger Corners
      { id: 201382, role: 'preferred', stars: 2, priority: 0 }, // Late Surger Straightaways
      { id: 200462, role: 'preferred', stars: 2, priority: 0 }, // Ramp Up
      { id: 201661, role: 'preferred', stars: 2, priority: 0 }, // Playtime's Over!
      { id: 201651, role: 'preferred', stars: 2, priority: 0 }, // Slipstream
    ],
  },
  {
    id: 'late-surger-parent-decent', name: 'Late surger parent (decent)',
    goal: { blueStats: ['speed', 'stamina', 'power', 'wit'], blueStars: 2, pink: [{ aptitude: 'any', stars: 2 }] },
    targets: [
      { id: 201591, role: 'required', stars: 2, priority: 0 }, // Uma Stan
      { id: 202161, role: 'preferred', stars: 2, priority: 0 }, // Restraint
      { id: 210101, role: 'preferred', stars: 2, priority: 0 }, // Racing Spirit: Stamina
      { id: 202452, role: 'preferred', stars: 2, priority: 0 }, // Pedal to the Metal
      { id: 210111, role: 'preferred', stars: 2, priority: 0 }, // Racing Spirit: Power
      { id: 201611, role: 'preferred', stars: 2, priority: 0 }, // Tail Held High
      { id: 200492, role: 'preferred', stars: 2, priority: 0 }, // Nimble Navigator
      { id: 201392, role: 'preferred', stars: 2, priority: 0 }, // Late Surger Corners
      { id: 201382, role: 'preferred', stars: 2, priority: 0 }, // Late Surger Straightaways
      { id: 200462, role: 'preferred', stars: 2, priority: 0 }, // Ramp Up
      { id: 201661, role: 'preferred', stars: 2, priority: 0 }, // Playtime's Over!
      { id: 201651, role: 'preferred', stars: 2, priority: 0 }, // Slipstream
    ],
  },
  {
    id: 'late-surger-parent-godly', name: 'Late surger parent (godly)',
    description: GODLY_DESCRIPTION,
    goal: { blueStats: ['speed', 'stamina', 'power'], blueStars: 3, pink: [{ aptitude: 'any', stars: 2 }] },
    targetLineage: {
      201591: { k1: 3, p1: 7, k2: 3, p2: 7 },
      202161: { k1: 3, p1: 7, k2: 3, p2: 7 },
      210101: { k1: 3, p1: 7, k2: 3, p2: 7 },
      202452: { k1: 3, p1: 7, k2: 3, p2: 7 },
      210111: { k1: 3, p1: 7, k2: 3, p2: 7 },
      201611: { k1: 3, p1: 7, k2: 3, p2: 7 },
      200492: { k1: 3, p1: 7, k2: 3, p2: 7 },
      200602: { k1: 3, p1: 7, k2: 3, p2: 7 },
    },
    targets: [
      { id: 201591, role: 'required', stars: 2, priority: 0 }, // Uma Stan
      { id: 202161, role: 'required', stars: 2, priority: 0 }, // Restraint
      { id: 210101, role: 'required', stars: 2, priority: 0 }, // Racing Spirit: Stamina
      { id: 202452, role: 'required', stars: 2, priority: 0 }, // Pedal to the Metal
      { id: 210111, role: 'required', stars: 2, priority: 0 }, // Racing Spirit: Power
      { id: 201611, role: 'required', stars: 2, priority: 0 }, // Tail Held High
      { id: 200492, role: 'required', stars: 2, priority: 0 }, // Nimble Navigator
      { id: 200602, role: 'required', stars: 2, priority: 0 }, // Slick Surge
      { id: 201392, role: 'preferred', stars: 2, priority: 0 }, // Late Surger Corners
      { id: 201382, role: 'preferred', stars: 2, priority: 0 }, // Late Surger Straightaways
      { id: 200462, role: 'preferred', stars: 2, priority: 0 }, // Ramp Up
      { id: 201661, role: 'preferred', stars: 2, priority: 0 }, // Playtime's Over!
      { id: 201651, role: 'preferred', stars: 2, priority: 0 }, // Slipstream
    ],
  },
  {
    id: 'end-closer-parent-lite', name: 'End closer parent (lite)',
    goal: { blueStats: ['speed', 'stamina', 'power', 'guts', 'wit'], blueStars: 2, pink: [{ aptitude: 'any', stars: 1 }] },
    targets: [
      { id: 201591, role: 'required', stars: 2, priority: 0 }, // Uma Stan
      { id: 201611, role: 'preferred', stars: 2, priority: 0 }, // Tail Held High
      { id: 200492, role: 'preferred', stars: 2, priority: 0 }, // Nimble Navigator
      { id: 201462, role: 'preferred', stars: 2, priority: 0 }, // End Closer Corners
      { id: 201452, role: 'preferred', stars: 2, priority: 0 }, // End Closer Straightaways
      { id: 200462, role: 'preferred', stars: 2, priority: 0 }, // Ramp Up
      { id: 201661, role: 'preferred', stars: 2, priority: 0 }, // Playtime's Over!
      { id: 201651, role: 'preferred', stars: 2, priority: 0 }, // Slipstream
      { id: 200642, role: 'preferred', stars: 2, priority: 0 }, // Straightaway Spurt
    ],
  },
  {
    id: 'end-closer-parent-decent', name: 'End closer parent (decent)',
    goal: { blueStats: ['speed', 'stamina', 'power', 'wit'], blueStars: 2, pink: [{ aptitude: 'any', stars: 2 }] },
    targets: [
      { id: 201591, role: 'required', stars: 2, priority: 0 }, // Uma Stan
      { id: 202161, role: 'preferred', stars: 2, priority: 0 }, // Restraint
      { id: 210101, role: 'preferred', stars: 2, priority: 0 }, // Racing Spirit: Stamina
      { id: 210111, role: 'preferred', stars: 2, priority: 0 }, // Racing Spirit: Power
      { id: 201611, role: 'preferred', stars: 2, priority: 0 }, // Tail Held High
      { id: 200492, role: 'preferred', stars: 2, priority: 0 }, // Nimble Navigator
      { id: 200642, role: 'preferred', stars: 2, priority: 0 }, // Straightaway Spurt
      { id: 201462, role: 'preferred', stars: 2, priority: 0 }, // End Closer Corners
      { id: 201452, role: 'preferred', stars: 2, priority: 0 }, // End Closer Straightaways
      { id: 200462, role: 'preferred', stars: 2, priority: 0 }, // Ramp Up
      { id: 201661, role: 'preferred', stars: 2, priority: 0 }, // Playtime's Over!
      { id: 201651, role: 'preferred', stars: 2, priority: 0 }, // Slipstream
    ],
  },
  {
    id: 'end-closer-parent-godly', name: 'End closer parent (godly)',
    description: GODLY_DESCRIPTION,
    goal: { blueStats: ['speed', 'stamina', 'power'], blueStars: 3, pink: [{ aptitude: 'any', stars: 2 }] },
    targetLineage: {
      201591: { k1: 3, p1: 7, k2: 3, p2: 7 },
      202161: { k1: 3, p1: 7, k2: 3, p2: 7 },
      210101: { k1: 3, p1: 7, k2: 3, p2: 7 },
      210111: { k1: 3, p1: 7, k2: 3, p2: 7 },
      201611: { k1: 3, p1: 7, k2: 3, p2: 7 },
      200492: { k1: 3, p1: 7, k2: 3, p2: 7 },
      200642: { k1: 3, p1: 7, k2: 3, p2: 7 },
    },
    targets: [
      { id: 201591, role: 'required', stars: 2, priority: 0 }, // Uma Stan
      { id: 202161, role: 'required', stars: 2, priority: 0 }, // Restraint
      { id: 210101, role: 'required', stars: 2, priority: 0 }, // Racing Spirit: Stamina
      { id: 210111, role: 'required', stars: 2, priority: 0 }, // Racing Spirit: Power
      { id: 201611, role: 'required', stars: 2, priority: 0 }, // Tail Held High
      { id: 200492, role: 'required', stars: 2, priority: 0 }, // Nimble Navigator
      { id: 200642, role: 'required', stars: 2, priority: 0 }, // Straightaway Spurt
      { id: 201462, role: 'preferred', stars: 2, priority: 0 }, // End Closer Corners
      { id: 201452, role: 'preferred', stars: 2, priority: 0 }, // End Closer Straightaways
      { id: 200462, role: 'preferred', stars: 2, priority: 0 }, // Ramp Up
      { id: 201661, role: 'preferred', stars: 2, priority: 0 }, // Playtime's Over!
      { id: 201651, role: 'preferred', stars: 2, priority: 0 }, // Slipstream
    ],
  },
];
