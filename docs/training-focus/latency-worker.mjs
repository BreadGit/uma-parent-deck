import { fixtures, inputs, measure } from './sweep.mjs';
const result=measure(inputs(fixtures()[201]),process.argv[2],{});
process.send({result,totalCpuMs:(process.resourceUsage().userCPUTime+process.resourceUsage().systemCPUTime)/1000,maxRssKiB:process.resourceUsage().maxRSS});
