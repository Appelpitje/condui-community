import {editProperties} from '@/handlers/properties/editProperties'
export function resizeConverterDcConnections(deviceId:string,requestedCount:number):boolean {
 return !!editProperties({actions:[{kind:'resizeConverter',deviceId,count:requestedCount}]})
}
