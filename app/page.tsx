import { QuantTerminal } from "@/app/components/QuantTerminal";
import { PwaRegister } from "@/app/components/PwaRegister";
import { getDashboardSnapshot } from "@/app/lib/repository";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await getDashboardSnapshot({ page: 1, pageSize: 100 });
  return (
    <>
      <QuantTerminal initialSnapshot={snapshot} />
      <PwaRegister />
    </>
  );
}
