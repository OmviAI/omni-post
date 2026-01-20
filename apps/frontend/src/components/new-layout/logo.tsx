'use client';

import Image from 'next/image';

export const Logo = () => {
  return (
    <div className="mt-[8px] flex items-center justify-center">
      <Image
        src="/prism-logo.png"
        alt="Prism Logo"
        width={60}
        height={60}
        priority
      />
    </div>
  );
};
