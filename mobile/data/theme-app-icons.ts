/**
 * The launcher icon.
 *
 * Deliberately *not* a theme knob. Every other setting in this folder is part
 * of a pack, and applying a pack changes it — which is right for a bubble
 * colour and wrong for the icon on somebody's home screen. Trying on a theme
 * should never quietly rearrange the thing they tap to open the app, so this
 * is a preference of its own, and only ever changes because someone chose it.
 *
 * Changing it is also not a repaint: it asks the OS to swap a component
 * alias, needs a native build to exist at all, and on iOS shows a system
 * dialog the person can refuse. The store treats it accordingly — see
 * `setAppIcon`.
 *
 * Pure: the ids and the names, no assets. The plugin names must match the
 * `expo-alternate-app-icons` entries in app.json exactly, because that is the
 * string the native side looks up.
 */

export type AppIconId = 'default' | 'sunset' | 'phosphor' | 'sakura' | 'void';

export type AppIconSpec = {
  id: AppIconId;
  /**
   * What the native module calls it, or `null` for the icon the app was
   * built with. `setAlternateAppIcon(null)` is how you go back.
   */
  pluginName: string | null;
  /** Not translated — these are the names of the packs they were drawn for. */
  label: string;
};

export const APP_ICONS: AppIconSpec[] = [
  { id: 'default', pluginName: null, label: 'Yo' },
  { id: 'sunset', pluginName: 'Sunset', label: 'Luanda Sunset' },
  { id: 'phosphor', pluginName: 'Phosphor', label: 'Phosphor' },
  { id: 'sakura', pluginName: 'Sakura', label: 'Sakura Milk' },
  { id: 'void', pluginName: 'Void', label: 'AMOLED Void' },
];

export const APP_ICON_IDS: AppIconId[] = APP_ICONS.map((i) => i.id);

export function appIconSpec(id: AppIconId): AppIconSpec {
  return APP_ICONS.find((i) => i.id === id) ?? APP_ICONS[0];
}

/** Map a native icon name back to an id — what the OS reports on launch. */
export function appIconFromPluginName(name: string | null): AppIconId {
  if (!name) return 'default';
  return APP_ICONS.find((i) => i.pluginName === name)?.id ?? 'default';
}
