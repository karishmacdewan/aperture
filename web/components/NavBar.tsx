import Link from "next/link";
import { Aperture } from "lucide-react";
import ThemeToggle from "@/components/ThemeToggle";

const LINKS = [
  { href: "/upload", label: "Upload" },
  { href: "/runs/new", label: "New run" },
  { href: "/runs", label: "History" },
];

export default function NavBar() {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
        <Link href="/" className="flex items-center gap-2 text-foreground">
          <Aperture className="size-[22px] text-primary" strokeWidth={1.75} />
          <span className="text-[15px] font-medium tracking-tight">Aperture</span>
        </Link>
        <div className="flex items-center gap-7">
          <nav className="flex gap-7 text-sm">
            {LINKS.map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-muted-foreground transition-colors hover:text-foreground"
              >
                {link.label}
              </Link>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </div>
    </header>
  );
}
