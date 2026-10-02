import Link from "next/link";
export default function NotFound() {
  return <div className="mx-auto max-w-md px-3 py-20 text-center"><h1 className="text-3xl font-black">Lost in the desert</h1><p className="mt-2 text-ink-500">That page doesn&apos;t exist.</p><Link href="/" className="btn-primary mt-4">Home</Link></div>;
}
