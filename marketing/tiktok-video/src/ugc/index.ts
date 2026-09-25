/** Every UGC script, one per Creator Search Insights content gap. Add a file to scripts/ and list it here. */
import { ARM_FAT } from "./scripts/arm-fat";
import { RUN_FASTER_5K } from "./scripts/run-faster-5k";
import { BENCH_NOT_GOING_UP } from "./scripts/bench-not-going-up";
import { RUNNING_BAD_FOR_GAINS } from "./scripts/running-bad-for-gains";
import { HYBRID_SPLIT } from "./scripts/hybrid-split";
import { HYROX_PLAN } from "./scripts/hyrox-plan";
import { ZONE_2 } from "./scripts/zone-2";
import type { UgcScript } from "./script";

export const UGC_SCRIPTS: UgcScript[] = [ARM_FAT, RUN_FASTER_5K, BENCH_NOT_GOING_UP, RUNNING_BAD_FOR_GAINS, HYBRID_SPLIT, HYROX_PLAN, ZONE_2];
