// The camera move library: 60 moves, each with the prompt it writes into a shot.
// `fx` picks the little diagram the Presets tool animates; `alias` helps the chat recognise a move.

export type MoveFx =
  | 'in'
  | 'out'
  | 'left'
  | 'right'
  | 'up'
  | 'down'
  | 'pan-l'
  | 'pan-r'
  | 'tilt-u'
  | 'tilt-d'
  | 'orbit-l'
  | 'orbit-r'
  | 'zoom-in'
  | 'zoom-out'
  | 'shake'
  | 'roll'
  | 'focus'
  | 'speed'
  | 'static';

export interface Move {
  id: string;
  name: string;
  group: MoveGroup;
  prompt: string;
  fx: MoveFx;
  alias?: string[];
}

export const MOVE_GROUPS = ['Push and pull', 'Lateral', 'Vertical', 'Pan and tilt', 'Orbit', 'Lens', 'Handheld', 'Aerial', 'Time', 'Angle'] as const;
export type MoveGroup = (typeof MOVE_GROUPS)[number];

const m = (id: string, name: string, group: MoveGroup, fx: MoveFx, prompt: string, alias?: string[]): Move => ({ id, name, group, fx, prompt, alias });

export const MOVES: Move[] = [
  // push and pull
  m('dolly-in', 'Dolly in', 'Push and pull', 'in', 'slow dolly in toward the subject, steady and smooth', ['dolly-in', 'dolly in', 'dolly forward']),
  m('dolly-out', 'Dolly out', 'Push and pull', 'out', 'smooth dolly out, moving away from the subject', ['dolly-out', 'dolly out', 'dolly back']),
  m('push-in', 'Push in', 'Push and pull', 'in', 'slow push in on the face, tension building', ['push in', 'push-in', 'push into']),
  m('pull-back', 'Pull back reveal', 'Push and pull', 'out', 'camera pulls back to reveal the whole scene', ['pull back', 'pull-back', 'pull out']),
  m('dolly-zoom', 'Dolly zoom', 'Push and pull', 'zoom-in', 'dolly zoom, the background stretches while the subject holds its size', ['vertigo', 'dolly zoom', 'zolly']),
  m('push-crowd', 'Push through crowd', 'Push and pull', 'in', 'camera pushes forward through a crowd toward the subject', ['through the crowd', 'through a crowd']),
  m('through-window', 'Through the window', 'Push and pull', 'in', 'camera glides through a window into the room', ['through the window', 'through a window']),
  // lateral
  m('truck-left', 'Truck left', 'Lateral', 'left', 'camera trucks left, parallel to the subject', ['truck left', 'slide left']),
  m('truck-right', 'Truck right', 'Lateral', 'right', 'camera trucks right, parallel to the subject', ['truck right', 'slide right']),
  m('tracking', 'Tracking shot', 'Lateral', 'right', 'tracking shot alongside the subject at walking pace', ['tracking', 'track alongside', 'tracking shot']),
  m('leading', 'Leading shot', 'Lateral', 'out', 'camera leads the subject, moving backward as they walk toward the lens', ['leading shot', 'lead the subject']),
  m('following', 'Following shot', 'Lateral', 'in', 'camera follows behind the subject at shoulder height', ['follow', 'following', 'follow behind']),
  m('parallax', 'Parallax slide', 'Lateral', 'left', 'lateral slide with strong foreground parallax', ['parallax']),
  m('reveal-behind', 'Reveal from behind', 'Lateral', 'right', 'camera slides out from behind a pillar to reveal the subject', ['reveal from behind', 'from behind a']),
  // vertical
  m('pedestal-up', 'Pedestal up', 'Vertical', 'up', 'camera rises straight up, the horizon stays level', ['pedestal up', 'rise up']),
  m('pedestal-down', 'Pedestal down', 'Vertical', 'down', 'camera lowers straight down, the horizon stays level', ['pedestal down', 'lower down']),
  m('crane-up', 'Crane up', 'Vertical', 'up', 'crane up and over the scene, rising high above', ['crane up', 'crane shot', 'crane']),
  m('crane-down', 'Crane down', 'Vertical', 'down', 'crane down from high above to eye level', ['crane down']),
  m('boom-reveal', 'Boom reveal', 'Vertical', 'up', 'boom up from behind a foreground object to reveal the scene', ['boom up', 'boom reveal', 'boom']),
  m('jib-arc', 'Jib arc', 'Vertical', 'orbit-r', 'jib arm sweeps up and around the subject in one arc', ['jib']),
  // pan and tilt
  m('pan-left', 'Pan left', 'Pan and tilt', 'pan-l', 'slow pan left across the scene', ['pan left']),
  m('pan-right', 'Pan right', 'Pan and tilt', 'pan-r', 'slow pan right across the scene', ['pan right', 'pan']),
  m('whip-pan', 'Whip pan', 'Pan and tilt', 'pan-r', 'fast whip pan with motion blur', ['whip pan', 'whip']),
  m('tilt-up', 'Tilt up', 'Pan and tilt', 'tilt-u', 'slow tilt up from the ground to the subject', ['tilt up']),
  m('tilt-down', 'Tilt down', 'Pan and tilt', 'tilt-d', 'slow tilt down from the sky to the subject', ['tilt down']),
  m('tilt-reveal', 'Tilt reveal', 'Pan and tilt', 'tilt-u', 'tilt up to reveal the towering scale of the place', ['tilt reveal']),
  // orbit
  m('orbit-left', 'Orbit left', 'Orbit', 'orbit-l', 'camera orbits left around the subject at a constant distance', ['orbit left', 'circle left']),
  m('orbit-right', 'Orbit right', 'Orbit', 'orbit-r', 'camera orbits right around the subject at a constant distance', ['orbit right', 'circle right', 'orbit']),
  m('orbit-360', '360 orbit', 'Orbit', 'orbit-r', 'full 360 degree orbit around the subject', ['360', 'full orbit', 'all the way around']),
  m('arc', 'Arc shot', 'Orbit', 'orbit-l', 'half arc around the subject, from profile to front', ['arc shot', 'arc']),
  m('spiral-up', 'Spiral up', 'Orbit', 'orbit-r', 'camera spirals upward around the subject', ['spiral']),
  m('bullet-time', 'Bullet time', 'Orbit', 'orbit-r', 'bullet time: the moment freezes while the camera orbits', ['bullet time', 'frozen moment']),
  // lens
  m('zoom-in', 'Zoom in', 'Lens', 'zoom-in', 'slow optical zoom in', ['zoom in', 'zoom into']),
  m('zoom-out', 'Zoom out', 'Lens', 'zoom-out', 'slow optical zoom out to a wide view', ['zoom out']),
  m('crash-zoom', 'Crash zoom', 'Lens', 'zoom-in', 'fast crash zoom into the subject', ['crash zoom']),
  m('snap-zoom', 'Snap zoom', 'Lens', 'zoom-in', 'snap zoom onto the detail', ['snap zoom']),
  m('rack-focus', 'Rack focus', 'Lens', 'focus', 'rack focus from the foreground to the subject', ['rack focus', 'focus pull', 'pull focus']),
  m('focus-out', 'Focus to background', 'Lens', 'focus', 'focus drifts from the subject to the background', ['focus to the background']),
  m('defocus', 'Defocus', 'Lens', 'focus', 'the image slowly melts into soft bokeh', ['defocus', 'bokeh']),
  // handheld
  m('handheld', 'Handheld', 'Handheld', 'shake', 'handheld camera, subtle natural shake', ['handheld', 'hand-held']),
  m('steadicam', 'Steadicam follow', 'Handheld', 'in', 'steadicam floats behind the subject through the space', ['steadicam', 'gimbal']),
  m('snorricam', 'Snorricam', 'Handheld', 'shake', 'body-mounted camera: the subject stays fixed while the world moves', ['snorricam', 'body mount']),
  m('shoulder-run', 'Shoulder run', 'Handheld', 'shake', 'running shoulder-rig camera with urgent energy', ['running camera', 'run with']),
  m('pov', 'POV walk', 'Handheld', 'in', 'first-person point of view, walking forward', ['pov', 'point of view', 'first-person']),
  m('ots', 'Over the shoulder', 'Handheld', 'right', 'over-the-shoulder shot with a slow drift', ['over the shoulder', 'ots']),
  // aerial
  m('flyover', 'Drone flyover', 'Aerial', 'in', 'aerial drone flyover, smooth forward motion high above', ['drone', 'flyover', 'aerial']),
  m('drone-reveal', 'Drone reveal', 'Aerial', 'up', 'drone rises over a ridge to reveal the landscape', ['drone reveal', 'over the ridge']),
  m('top-down', 'Top-down spin', 'Aerial', 'roll', 'top-down aerial view, slowly rotating', ['top-down', 'top down', 'overhead']),
  m('fpv-dive', 'FPV dive', 'Aerial', 'down', 'fast FPV drone dive down the face of the building', ['fpv', 'dive']),
  m('birds-eye', 'Bird’s eye pull', 'Aerial', 'out', 'bird’s eye view pulling straight up into the sky', ['bird’s eye', "bird's eye", 'birds eye']),
  m('car-mount', 'Car mount', 'Aerial', 'speed', 'camera rigged to the car, the road rushing past', ['car mount', 'car rig']),
  // time
  m('slow-mo', 'Slow motion', 'Time', 'speed', 'slow motion with a 120 fps feel', ['slow motion', 'slow-mo', 'slowmo']),
  m('speed-ramp', 'Speed ramp', 'Time', 'speed', 'speed ramp from real time into slow motion', ['speed ramp', 'ramp']),
  m('timelapse', 'Time-lapse', 'Time', 'static', 'locked time-lapse, clouds and light sweep across', ['time-lapse', 'timelapse', 'time lapse']),
  m('hyperlapse', 'Hyperlapse', 'Time', 'in', 'moving hyperlapse through the city', ['hyperlapse']),
  m('locked-off', 'Locked off', 'Time', 'static', 'locked-off static shot, no camera movement', ['static', 'locked off', 'locked-off', 'still camera']),
  // angle
  m('dutch-roll', 'Dutch roll', 'Angle', 'roll', 'camera rolls into a dutch angle', ['dutch', 'dutch angle', 'canted']),
  m('barrel-roll', 'Barrel roll', 'Angle', 'roll', 'full barrel roll around the lens axis', ['barrel roll']),
  m('low-push', 'Low angle push', 'Angle', 'in', 'low angle push in, the subject towers over the lens', ['low angle', 'low-angle']),
  m('worms-eye', 'Worm’s eye tilt', 'Angle', 'tilt-u', 'worm’s eye view, tilting up as the subject passes overhead', ['worm’s eye', "worm's eye", 'worms eye']),
];

export const moveById = (id: string) => MOVES.find((x) => x.id === id);
