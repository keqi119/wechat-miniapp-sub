import {hash} from '../common/data';
export function cooperationBusinessHash(ownerId:string,revision:number,scope:{vehicleIds:string[];validFrom:string;validUntil:string}){
 return hash({ownerId,revision,scope:{vehicleIds:[...scope.vehicleIds].sort(),validFrom:scope.validFrom,validUntil:scope.validUntil}});
}
