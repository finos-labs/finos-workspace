import { Outlet } from "react-router-dom";

export default function LayoutUnauth() {
  return (
    <div className="flex flex-col items-center justify-center md:justify-start xl:justify-center min-h-screen overflow-y-auto bg-surface-page">
      <main className="only-sm:w-[90%] md:min-w-[408px] lg:min-w-[1000px] lg:py-20 2xl:py-0 py-0">
        <Outlet />
      </main>
    </div>
  );
}
