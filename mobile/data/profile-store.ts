/**
 * Cross-screen profile store backed by the auth store and the users API.
 *
 * The profile screen reads from useCurrentUser() for reactive updates;
 * writes go through patchMe() to the server.
 */

import { useState } from 'react';

import { uploadMedia } from './api/media';
import { patchMe, type UserPatch } from './api/users';
import { useCurrentUser } from './auth-store';

export function useProfile() {
  const user = useCurrentUser();
  return {
    name: user?.display_name ?? '',
    username: user?.username ?? '',
    bio: user?.bio ?? '',
    avatarUri: user?.avatar_uri ?? '',
    // Just the handle. It used to read `socialize.app/@name`, which looked
    // like a web address for a site that has never existed — someone could
    // reasonably have typed it into a browser, or given it to a friend.
    link: user?.username ? `@${user.username}` : '',
  };
}

export async function updateProfile(patch: {
  name?: string;
  username?: string;
  bio?: string;
  location?: string;
  avatarUri?: string | null;
}) {
  const body: UserPatch = {};
  if (patch.name !== undefined) body.display_name = patch.name;
  if (patch.username !== undefined) body.username = patch.username;
  if (patch.bio !== undefined) body.bio = patch.bio;
  if (patch.avatarUri !== undefined && patch.avatarUri !== null) {
    body.avatar_uri = await resolveAvatarUrl(patch.avatarUri);
  }
  if (Object.keys(body).length === 0) return;
  await patchMe(body);
}


/**
 * Turn whatever the picker handed back into something the server can serve.
 *
 * This used to send the picker's URI straight through, which is a path inside
 * this app's own sandbox — `file:///data/user/0/…/ImagePicker/abc.jpg`. The
 * server stored it, every other device was handed it, and none of them could
 * open it; the owner lost it too, as soon as the OS cleared its cache. A
 * profile photo that only exists on the phone that chose it is not a profile
 * photo.
 *
 * The upload path has existed the whole time — `channel/create` has used it
 * for channel avatars since channels shipped. This is the same call.
 */
async function resolveAvatarUrl(uri: string): Promise<string> {
  // Already served by somebody: an earlier upload, or an avatar that came
  // back from the API. Re-uploading it would make a second copy of a file
  // this device may not even have.
  if (/^https?:\/\//i.test(uri)) return uri;

  const uploaded = await uploadMedia({ uri, mimeType: 'image/jpeg' });
  return uploaded.url;
}
