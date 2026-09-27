import Space from "@/components/space";

export default function Home() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-black">
      <Space />
      <h1 className="pointer-events-none absolute inset-x-0 top-0 z-10 select-none pt-7 pl-[0.42em] text-center font-sans text-[11px] font-light uppercase tracking-[0.42em] text-white/25 sm:pt-9 sm:text-xs">
        Konstantin Stanmeyer
      </h1>
    </main>
  );
}
