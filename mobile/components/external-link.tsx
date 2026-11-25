import { Href, Link } from 'expo-router';
import { type ComponentProps } from 'react';

import { openInApp } from '@/data/browser';

type Props = Omit<ComponentProps<typeof Link>, 'href'> & { href: Href & string };

/** A link that opens through openInApp: official links natively, the rest in-app (#348). */
export function ExternalLink({ href, ...rest }: Props) {
  return (
    <Link
      target="_blank"
      {...rest}
      href={href}
      onPress={async (event) => {
        if (process.env.EXPO_OS !== 'web') {
          event.preventDefault();
          await openInApp(href);
        }
      }}
    />
  );
}
