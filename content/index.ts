import type { Career } from "./schema";
import teacher from "./careers/teacher.json";
import swe from "./careers/swe.json";
import plumber from "./careers/plumber.json";

export const careers: Career[] = [teacher, swe, plumber] as Career[];
export const getCareer = (id: string): Career | undefined => careers.find((c) => c.id === id);
