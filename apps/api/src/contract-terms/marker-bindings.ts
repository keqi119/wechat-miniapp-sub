// Generated from read-only V3.1 DOCX by scripts/ninda/build-v31-templates.py.
export const markerBindings = {
  "01": [
    {
      "id": "01:P012:0",
      "loc": "P012",
      "token": "【待填写】",
      "category": "PARAMETER",
      "binding": "product.minimumTermMonths",
      "required": true
    },
    {
      "id": "01:P076:0",
      "loc": "P076",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "CUSTOMER",
      "required": true
    },
    {
      "id": "01:P077:0",
      "loc": "P077",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "OWNER",
      "required": true
    },
    {
      "id": "01:P078:0",
      "loc": "P078",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "PLATFORM",
      "required": true
    },
    {
      "id": "01:T1R1C2:0",
      "loc": "T1R1C2",
      "token": "【自动带入：本合同编号、原订单编号、模板版本】",
      "category": "BLOCK",
      "binding": "document.references",
      "required": true
    },
    {
      "id": "01:T1R2C2:0",
      "loc": "T1R2C2",
      "token": "【自动带入：甲方实名姓名、必要证件识别信息、已核验本人手机号及账号、已有联系地址；乙方与丙方企业全称、统一社会信用代码、住所、有效签署身份及权限；已确认企业服务联系人及电话或可留痕渠道】",
      "category": "BLOCK",
      "binding": "parties.details",
      "required": true
    },
    {
      "id": "01:T1R3C2:0",
      "loc": "T1R3C2",
      "token": "【自动带入：已确认产品及版本、约定月数、含税总月费及组成、押金、月含里程、超额单价、赠送及另购换车权益、单次服务费、BaaS包含或另付的金额及对象】",
      "category": "BLOCK",
      "binding": "subscription.conditions",
      "required": true
    },
    {
      "id": "01:T1R4C2:0",
      "loc": "T1R4C2",
      "token": "【自动带入：品牌车型、车牌、VIN、登记所有人、电池方式及签前应披露的重要限制】",
      "category": "BLOCK",
      "binding": "vehicle.disclosures",
      "required": true
    },
    {
      "id": "01:T1R5C2:0",
      "loc": "T1R5C2",
      "token": "【自动带入：本单已确认的计划交付日期及地点】",
      "category": "BLOCK",
      "binding": "delivery.plan",
      "required": true
    },
    {
      "id": "01:T1R7C2:0",
      "loc": "T1R7C2",
      "token": "【自动带入：本车已确定险种、保险公司、有效保单号】",
      "category": "BLOCK",
      "binding": "insurance.facts",
      "required": true
    }
  ],
  "02-main": [
    {
      "id": "02-main:P065:0",
      "loc": "P065",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "PLATFORM",
      "required": true
    },
    {
      "id": "02-main:P066:0",
      "loc": "P066",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "OWNER",
      "required": true
    },
    {
      "id": "02-main:P069:0",
      "loc": "P069",
      "token": "【自动带入：双方经核验的企业名称、统一社会信用代码、住所、有权签署人身份和权限来源；双方已确认的业务联系人及电话或可留痕官方渠道；乙方经核验对公账户】",
      "category": "BLOCK",
      "binding": "partiesAndAccount.details",
      "required": true
    },
    {
      "id": "02-main:P070:0",
      "loc": "P070",
      "token": "【自动带入：合作档案中双方确认的起止日期、逐辆VIN、车牌、品牌车型、登记所有人、电池方式及适用期间】",
      "category": "BLOCK",
      "binding": "cooperation.vehicles",
      "required": true
    },
    {
      "id": "02-main:P071:0",
      "loc": "P071",
      "token": "【自动带入：适用车辆或来源范围、乙方租金分润比例及适用起日】",
      "category": "BLOCK",
      "binding": "cooperation.revenue",
      "required": true
    },
    {
      "id": "02-main:P071:1",
      "loc": "P071",
      "token": "【待填写】",
      "category": "PARAMETER",
      "binding": "cooperation.partnerRateBps",
      "required": true
    },
    {
      "id": "02-main:P072:0",
      "loc": "P072",
      "token": "【自动带入：本次合作可售产品及版本、月费或明确授权区间、押金规则、期限范围、里程及换车权益，以及适用三方合同的完整版本标识和对应固定内容】",
      "category": "BLOCK",
      "binding": "cooperation.products",
      "required": true
    },
    {
      "id": "02-main:P072:1",
      "loc": "P072",
      "token": "【待填写】",
      "category": "PARAMETER",
      "binding": "cooperation.minimumTerms",
      "required": true
    }
  ],
  "02-grant": [
    {
      "id": "02-grant:P089:0",
      "loc": "P089",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "OWNER",
      "required": true
    },
    {
      "id": "02-grant:P090:0",
      "loc": "P090",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "PLATFORM",
      "required": true
    }
  ],
  "03": [
    {
      "id": "03:T1R1C2:0",
      "loc": "T1R1C2",
      "token": "【自动带入：本次协议及业务编号、原合同和订单编号、三方真实身份识别及有效联系渠道；有效补充文件关联】",
      "category": "BLOCK",
      "binding": "document.referencesAndParties",
      "required": true
    },
    {
      "id": "03:T1R2C2:0",
      "loc": "T1R2C2",
      "token": "【自动带入：两车品牌车型、车牌、VIN、登记所有人、电池方式；实际出租方一致核验；原起租日、到期日及当前服务月】",
      "category": "BLOCK",
      "binding": "swap.vehiclesAndPeriod",
      "required": true
    },
    {
      "id": "03:T1R3C2:0",
      "loc": "T1R3C2",
      "token": "【自动带入：同价或升级类型、原及新含税月费及组成、BaaS是否另付及金额对象、差价公式、适用权益和服务费、既有报价中的付款安排、当前已知应补退】",
      "category": "BLOCK",
      "binding": "swap.financialTerms",
      "required": true
    },
    {
      "id": "03:T1R4C2:0",
      "loc": "T1R4C2",
      "token": "【自动带入：计划还旧和交新日期地点、新车险种、保险公司及现有保单号或真实投保状态】",
      "category": "BLOCK",
      "binding": "swap.deliveryAndInsurance",
      "required": true
    },
    {
      "id": "03:P033:0",
      "loc": "P033",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "CUSTOMER",
      "required": true
    },
    {
      "id": "03:P034:0",
      "loc": "P034",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "OWNER",
      "required": true
    },
    {
      "id": "03:P035:0",
      "loc": "P035",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "PLATFORM",
      "required": true
    }
  ],
  "04": [
    {
      "id": "04:T1R1C2:0",
      "loc": "T1R1C2",
      "token": "【自动带入：本次协议及业务编号、原合同和订单编号、三方真实身份识别及有效联系渠道；有效补充文件关联】",
      "category": "BLOCK",
      "binding": "document.referencesAndParties",
      "required": true
    },
    {
      "id": "04:T1R2C2:0",
      "loc": "T1R2C2",
      "token": "【自动带入：原车车牌及VIN、取消原因与已确认责任、实际从未交付的核验事实】",
      "category": "BLOCK",
      "binding": "cancellation.facts",
      "required": true
    },
    {
      "id": "04:T1R3C2:0",
      "loc": "T1R3C2",
      "token": "【自动带入：签前已知的成功收退、已确认项目及金额、无争议应补退、具体费用依据；仅有例外时显示明确协商条件】",
      "category": "BLOCK",
      "binding": "cancellation.financialTerms",
      "required": true
    },
    {
      "id": "04:P033:0",
      "loc": "P033",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "CUSTOMER",
      "required": true
    },
    {
      "id": "04:P034:0",
      "loc": "P034",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "OWNER",
      "required": true
    },
    {
      "id": "04:P035:0",
      "loc": "P035",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "PLATFORM",
      "required": true
    }
  ],
  "05": [
    {
      "id": "05:T1R1C2:0",
      "loc": "T1R1C2",
      "token": "【自动带入：本次协议及业务编号、原合同和订单编号、三方真实身份识别及有效联系渠道；有效补充文件关联】",
      "category": "BLOCK",
      "binding": "document.referencesAndParties",
      "required": true
    },
    {
      "id": "05:T1R2C2:0",
      "loc": "T1R2C2",
      "token": "【自动带入：原车品牌车型、车牌、VIN、原起租日原日号、原阶段起止、当前月费及押金】",
      "category": "BLOCK",
      "binding": "renewal.originalTerms",
      "required": true
    },
    {
      "id": "05:T1R3C2:0",
      "loc": "T1R3C2",
      "token": "【自动带入：确认的新产品和版本、约定月数、新阶段起日及止日、含税总月费及组成、里程及超额单价、赠送换车次数和其他价格权益、BaaS包含或另付的金额对象、已确认付款安排】",
      "category": "BLOCK",
      "binding": "renewal.newTerms",
      "required": true
    },
    {
      "id": "05:T1R4C2:0",
      "loc": "T1R4C2",
      "token": "【自动带入：已确认的具体例外】",
      "category": "BLOCK",
      "binding": "renewal.exceptions",
      "required": false
    },
    {
      "id": "05:P008:0",
      "loc": "P008",
      "token": "【待填写】",
      "category": "PARAMETER",
      "binding": "product.minimumTermMonths",
      "required": true
    },
    {
      "id": "05:P037:0",
      "loc": "P037",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "CUSTOMER",
      "required": true
    },
    {
      "id": "05:P038:0",
      "loc": "P038",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "OWNER",
      "required": true
    },
    {
      "id": "05:P039:0",
      "loc": "P039",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "PLATFORM",
      "required": true
    }
  ],
  "06": [
    {
      "id": "06:T1R1C2:0",
      "loc": "T1R1C2",
      "token": "【自动带入：本次协议及业务编号、原合同和订单编号、三方真实身份识别及有效联系渠道；有效补充文件关联】",
      "category": "BLOCK",
      "binding": "document.referencesAndParties",
      "required": true
    },
    {
      "id": "06:T1R2C2:0",
      "loc": "T1R2C2",
      "token": "【自动带入：车牌及VIN、原期限及当前月费、终止原因与范围、已确认计划还车日期地点】",
      "category": "BLOCK",
      "binding": "termination.facts",
      "required": true
    },
    {
      "id": "06:T1R3C2:0",
      "loc": "T1R3C2",
      "token": "【自动带入：签前已知实收实退、已确定费用及减免、适用提前退租补偿及计算规则；仅有例外时显示更早停租或其他明确协商条件】",
      "category": "BLOCK",
      "binding": "termination.financialTerms",
      "required": true
    },
    {
      "id": "06:P038:0",
      "loc": "P038",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "CUSTOMER",
      "required": true
    },
    {
      "id": "06:P039:0",
      "loc": "P039",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "OWNER",
      "required": true
    },
    {
      "id": "06:P040:0",
      "loc": "P040",
      "token": "【电子签署区】",
      "category": "SIGNATURE",
      "binding": "PLATFORM",
      "required": true
    }
  ]
} as const;
